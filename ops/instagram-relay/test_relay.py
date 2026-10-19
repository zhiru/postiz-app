import hashlib
import http.client
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import relay

SECRET = b'test-only-meta-secret'
ALLOWED = {'17841444312334737', '200'}


def body(entries=None):
    return json.dumps({'object': 'instagram', 'entry': entries if entries is not None else [
        {'id': '17841444312334737', 'changes': [{'field': 'comments', 'value': {'id': 'comment-1', 'text': 'Ol\u00e1!'}}]}
    ]}, ensure_ascii=False, indent=2).encode()


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        os.chmod(self.temp.name, 0o700)
        self.store = relay.Store(self.temp.name, SECRET, ALLOWED)
        self.raw = body()

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def accept(self, raw=None):
        raw = self.raw if raw is None else raw
        return self.store.accept(raw, relay.sign(SECRET, raw), 'application/json; charset=utf-8')

    def event(self):
        return next(iter(self.store.events.values()))

    def restart(self):
        self.store.close()
        self.store = relay.Store(self.temp.name, SECRET, ALLOWED)

    def test_exact_raw_bytes_and_signature_for_owned_batch(self):
        self.accept()
        for destination in relay.DESTINATIONS:
            _, raw, signature, content_type = self.store.take(destination)
            self.assertEqual(raw, self.raw)
            self.assertEqual(signature, relay.sign(SECRET, self.raw))
            self.assertEqual(content_type, 'application/json; charset=utf-8')

    def test_mixed_batch_preserves_hermes_but_filters_and_resigns_postiz(self):
        raw = body([{'id': 'unowned', 'messaging': [{'private': 'other tenant'}]}, {'id': '200', 'changes': []}])
        self.accept(raw)
        _, hermes_raw, hermes_signature, _ = self.store.take('hermes')
        _, postiz_raw, postiz_signature, _ = self.store.take('postiz')
        self.assertEqual(hermes_raw, raw)
        self.assertEqual(hermes_signature, relay.sign(SECRET, raw))
        self.assertEqual(json.loads(postiz_raw)['entry'], [{'id': '200', 'changes': []}])
        self.assertNotIn(b'other tenant', postiz_raw)
        self.assertEqual(postiz_signature, relay.sign(SECRET, postiz_raw))
        self.assertNotEqual(postiz_signature, hermes_signature)

    def test_unowned_only_is_never_sent_to_postiz(self):
        self.accept(body([{'id': 'unowned'}]))
        self.assertIsNone(self.store.take('postiz'))
        self.assertIsNotNone(self.store.take('hermes'))

    def test_invalid_signature_never_persists(self):
        with self.assertRaises(relay.Rejected) as error:
            self.store.accept(self.raw, relay.sign(b'wrong', self.raw), 'application/json')
        self.assertEqual(error.exception.status, 401)
        self.assertFalse(self.store.events)
        self.assertFalse(list(Path(self.temp.name).glob('*.json')))

    def test_non_ascii_signature_is_rejected(self):
        with self.assertRaises(relay.Rejected) as error:
            self.store.accept(self.raw, 'sha256=é', 'application/json')
        self.assertEqual(error.exception.status, 401)

    def test_missing_signature_is_rejected(self):
        with self.assertRaises(relay.Rejected):
            self.store.accept(self.raw, None, 'application/json')

    def test_bad_content_type_is_rejected(self):
        with self.assertRaises(relay.Rejected) as error:
            self.store.accept(self.raw, relay.sign(SECRET, self.raw), 'text/plain')
        self.assertEqual(error.exception.status, 415)

    def test_invalid_payload_shapes_are_rejected(self):
        for raw in (b'no json', b'[]', b'{}', body([1]), body([{}] * 101), b'{"object":"instagram","entry":{}}'):
            with self.subTest(raw=raw[:40]), self.assertRaises(relay.Rejected):
                self.accept(raw)
        self.assertFalse(self.store.events)

    def test_oversized_body_rejected(self):
        with self.assertRaises(relay.Rejected) as error:
            self.accept(b'x' * (relay.MAX_BODY_BYTES + 1))
        self.assertEqual(error.exception.status, 413)

    def test_duplicate_is_durable_before_and_after_restart(self):
        self.assertTrue(self.accept())
        self.assertFalse(self.accept())
        self.restart()
        self.assertFalse(self.accept())
        self.assertEqual(len(self.store.events), 1)

    def test_receipt_removes_content_and_deduplicates_after_success(self):
        self.accept()
        digest = hashlib.sha256(self.raw).hexdigest()
        for destination in relay.DESTINATIONS:
            relay.deliver(self.store, destination, lambda *_: (200, b'', 'application/json'))
        self.assertFalse(self.store.events)
        self.assertFalse((Path(self.temp.name) / (digest + '.json')).exists())
        self.assertEqual(set(json.loads((Path(self.temp.name) / 'receipts' / digest).read_text())), {'completed'})
        self.restart()
        self.assertFalse(self.accept())

    def test_separate_deliveries_allow_hermes_while_postiz_is_down(self):
        self.accept()
        relay.deliver(self.store, 'postiz', lambda *_: (503, b'', 'application/json'))
        relay.deliver(self.store, 'hermes', lambda *_: (200, b'', 'application/json'))
        self.assertEqual(self.event()['deliveries']['hermes']['state'], 'sent')
        self.assertEqual(self.event()['deliveries']['postiz']['state'], 'pending')
        self.restart()
        self.assertIsNone(self.store.take('hermes'))
        self.event()['deliveries']['postiz']['next'] = 0
        relay.deliver(self.store, 'postiz', lambda *_: (200, b'', 'application/json'))
        self.assertFalse(self.store.events)

    def test_retryable_statuses_are_durable_with_backoff(self):
        for status in (None, 408, 425, 429, 500, 503):
            with self.subTest(status=status):
                self.accept()
                digest = hashlib.sha256(self.raw).hexdigest()
                self.store.finish(digest, 'hermes', status)
                state = self.event()['deliveries']['hermes']
                self.assertEqual(state['state'], 'pending')
                self.assertGreater(state['next'], time.time())
                self.assertIsNone(self.store.take('hermes'))
        self.restart()
        self.assertEqual(self.event()['deliveries']['hermes']['attempts'], 6)

    def test_permanent_errors_and_redirects_are_dead_lettered(self):
        for status in (301, 302, 400, 401, 403, 404):
            with self.subTest(status=status):
                self.accept()
                digest = hashlib.sha256(self.raw).hexdigest()
                self.store.finish(digest, 'postiz', status)
                self.assertEqual(self.event()['deliveries']['postiz']['state'], 'dead')
                self.assertIsNone(self.store.take('postiz'))
                self.assertEqual(self.store.health()['dead'], 1)
        self.restart()
        self.assertEqual(self.store.health()['dead'], 1)

    def test_unknown_send_result_retries_without_losing_event(self):
        self.accept()
        def timeout(*_):
            raise TimeoutError()
        relay.deliver(self.store, 'postiz', timeout)
        self.restart()
        state = self.event()['deliveries']['postiz']
        self.assertEqual(state['state'], 'pending')
        self.assertEqual(state['attempts'], 1)

    def test_retry_attempt_limit_keeps_dead_letter_payload(self):
        self.accept()
        self.event()['deliveries']['postiz']['attempts'] = relay.MAX_ATTEMPTS - 1
        digest = hashlib.sha256(self.raw).hexdigest()
        self.store.finish(digest, 'postiz', 503)
        self.assertEqual(self.event()['deliveries']['postiz']['state'], 'dead')
        self.assertTrue((Path(self.temp.name) / (digest + '.json')).exists())

    def test_failed_durable_write_is_not_accepted(self):
        with patch.object(relay, 'atomic_write', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                self.accept()
        self.assertFalse(self.store.events)
        self.restart()
        self.assertTrue(self.accept())

    def test_queue_count_and_byte_bounds_apply_before_acceptance(self):
        for attribute, value in (('max_events', 0), ('max_bytes', 1)):
            with self.subTest(attribute=attribute):
                previous = getattr(self.store, attribute)
                setattr(self.store, attribute, value)
                with self.assertRaises(relay.Rejected) as error:
                    self.accept()
                self.assertEqual(error.exception.status, 503)
                setattr(self.store, attribute, previous)
        self.assertFalse(self.store.events)

    def test_each_destination_can_only_claim_event_once(self):
        self.accept()
        self.assertIsNotNone(self.store.take('postiz'))
        self.assertIsNone(self.store.take('postiz'))
        self.assertIsNotNone(self.store.take('hermes'))

    def test_restart_recovers_after_external_ack_before_persisting(self):
        self.accept()
        self.store.take('postiz')
        self.restart()
        self.assertIsNotNone(self.store.take('postiz'))

    def test_spool_is_exclusive(self):
        with self.assertRaisesRegex(ValueError, 'Another relay'):
            relay.Store(self.temp.name, SECRET, ALLOWED)

    def test_world_readable_spool_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            os.chmod(directory, 0o755)
            with self.assertRaisesRegex(ValueError, '0700'):
                relay.Store(directory, SECRET, ALLOWED)

    def test_legacy_completed_item_is_retired_on_restart(self):
        self.accept()
        digest = hashlib.sha256(self.raw).hexdigest()
        for state in self.event()['deliveries'].values():
            state['state'] = 'sent'
        relay.atomic_write(Path(self.temp.name) / (digest + '.json'), self.event())
        self.restart()
        self.assertFalse(self.store.events)
        self.assertFalse(self.accept())

    def test_manual_retry_only_resets_selected_dead_delivery(self):
        self.accept()
        digest = hashlib.sha256(self.raw).hexdigest()
        self.store.finish(digest, 'hermes', 200)
        self.store.finish(digest, 'postiz', 403)
        self.store.retry_dead(digest, 'postiz')
        self.assertEqual(self.event()['deliveries']['hermes']['state'], 'sent')
        self.assertEqual(self.event()['deliveries']['postiz'], {'state': 'pending', 'attempts': 0, 'next': 0})
        self.restart()
        self.assertIsNotNone(self.store.take('postiz'))
        with self.assertRaises(ValueError):
            self.store.retry_dead(digest, 'hermes')
        with self.assertRaises(ValueError):
            self.store.retry_dead('../escape', 'postiz')

    def test_empty_configuration_fails_closed(self):
        for secret, allowed in ((b'', ALLOWED), (SECRET, set()), (SECRET, {'not-numeric'})):
            with self.assertRaises(ValueError):
                relay.Store('/should-not-be-created', secret, allowed)

    def test_transport_preserves_headers_and_body(self):
        self.accept()
        with patch.object(relay, 'request') as _unused:
            seen = []
            relay.deliver(self.store, 'postiz', lambda *args: (seen.append(args) or (200, b'', 'application/json')))
        self.assertEqual(seen[0][0], relay.POSTIZ_URL)
        self.assertEqual(seen[0][2], self.raw)
        self.assertEqual(seen[0][3]['X-Hub-Signature-256'], relay.sign(SECRET, self.raw))

    def test_transport_never_follows_redirects(self):
        connection = unittest.mock.MagicMock()
        connection.getresponse.return_value.status = 302
        connection.getresponse.return_value.read.return_value = b''
        with patch.object(relay.http.client, 'HTTPSConnection', return_value=connection) as factory:
            result = relay.request(relay.POSTIZ_URL, 'POST', b'{}')
        self.assertEqual(result[0], 302)
        factory.assert_called_once()
        connection.request.assert_called_once()
        self.assertIsNotNone(factory.call_args.kwargs['context'])


class HttpTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        os.chmod(self.temp.name, 0o700)
        self.store = relay.Store(self.temp.name, SECRET, ALLOWED)
        self.server = relay.Server(('127.0.0.1', 0), self.store)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.store.close()
        self.temp.cleanup()

    def send(self, method='POST', path='/webhooks/instagram', raw=None, signature=None, headers=None):
        raw = body() if raw is None else raw
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=2)
        request_headers = {'Content-Type': 'application/json', 'X-Hub-Signature-256': signature or relay.sign(SECRET, raw)}
        request_headers.update(headers or {})
        connection.request(method, path, raw if method == 'POST' else None, request_headers)
        response = connection.getresponse()
        result = response.status, response.read()
        connection.close()
        return result

    def test_http_ack_only_after_queue_commit_and_duplicate_is_acknowledged(self):
        self.assertEqual(self.send(), (200, b'{"status":"queued"}'))
        self.assertTrue(list(Path(self.temp.name).glob('*.json')))
        self.assertEqual(self.send(), (200, b'{"status":"duplicate"}'))

    def test_http_invalid_signature_rejected(self):
        self.assertEqual(self.send(signature='sha256=bad')[0], 401)
        self.assertFalse(self.store.events)

    def test_http_full_or_unwritable_queue_returns_503(self):
        with patch.object(relay, 'atomic_write', side_effect=OSError()):
            self.assertEqual(self.send()[0], 503)
        self.store.max_events = 0
        self.assertEqual(self.send()[0], 503)

    def test_http_wrong_path_is_not_proxied(self):
        self.assertEqual(self.send(path='/unrelated')[0], 404)

    def test_http_large_and_chunked_requests_are_rejected(self):
        self.assertEqual(self.send(headers={'Content-Length': str(relay.MAX_BODY_BYTES + 1)})[0], 413)
        self.assertEqual(self.send(headers={'Transfer-Encoding': 'chunked'})[0], 400)

    def test_verification_query_passes_through_to_existing_hermes(self):
        with patch.object(relay, 'request', return_value=(200, b'12345', 'text/plain')) as transport:
            self.assertEqual(self.send('GET', '/webhooks/instagram?hub.mode=subscribe&hub.challenge=12345'), (200, b'12345'))
        transport.assert_called_once_with(relay.HERMES_URL + '?hub.mode=subscribe&hub.challenge=12345', 'GET')

    def test_health_contains_only_queue_counts(self):
        self.send()
        status, raw = self.send('GET', '/health')
        self.assertEqual(status, 200)
        self.assertEqual(set(json.loads(raw)), {'pending', 'dead', 'queued_bytes', 'oldest_pending_seconds'})
        self.assertNotIn(b'Ol', raw)


if __name__ == '__main__':
    unittest.main()
