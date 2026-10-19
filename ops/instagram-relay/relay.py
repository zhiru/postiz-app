#!/usr/bin/env python3
"""Durable fan-out for the existing Instagram callback; Python standard library only."""
import argparse
import base64
import hashlib
import fcntl
import hmac
import http.client
import json
import logging
import os
from pathlib import Path
import random
import re
import ssl
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

POSTIZ_URL = 'https://postiz-app.aireset.com.br/api/public/ig-webhook'
HERMES_URL = 'http://127.0.0.1:45104/webhooks/instagram'
DESTINATIONS = ('hermes', 'postiz')
MAX_BODY_BYTES = 1024 * 1024
MAX_ATTEMPTS = 100
RECEIPT_TTL = 30 * 86400
LOG = logging.getLogger('instagram-relay')


def sign(secret, body):
    return 'sha256=' + hmac.new(secret, body, hashlib.sha256).hexdigest()


def atomic_write(path, value):
    temporary = path.with_suffix('.tmp')
    with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'wb') as output:
        output.write(json.dumps(value, separators=(',', ':')).encode())
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)
    descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


class Rejected(Exception):
    def __init__(self, status):
        self.status = status


class Store:
    def __init__(self, directory, secret, allowed_ids, max_bytes=64 * 1024 * 1024, max_events=5000):
        if not secret or not allowed_ids or not all(re.fullmatch(r'\d+', value) for value in allowed_ids):
            raise ValueError('A signing secret and numeric Instagram account allowlist are required')
        self.directory = Path(directory)
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        if self.directory.stat().st_mode & 0o077:
            raise ValueError('The spool directory must have mode 0700')
        self.process_lock = (self.directory / '.lock').open('a')
        try:
            fcntl.flock(self.process_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.process_lock.close()
            raise ValueError('Another relay owns this spool')
        self.receipts = self.directory / 'receipts'
        self.receipts.mkdir(mode=0o700, exist_ok=True)
        self.secret, self.allowed_ids = secret, set(allowed_ids)
        self.max_bytes, self.max_events = max_bytes, max_events
        self.lock = threading.Lock()
        self.events = {path.stem: json.loads(path.read_bytes()) for path in self.directory.glob('*.json')}
        for digest, event in list(self.events.items()):
            if all(value['state'] in ('sent', 'skipped') for value in event['deliveries'].values()):
                atomic_write(self.receipts / digest, {'completed': time.time()})
                (self.directory / (digest + '.json')).unlink()
                del self.events[digest]
        self.inflight = set()
        self.last_pruned = 0

    def close(self):
        self.process_lock.close()

    def accept(self, body, signature, content_type):
        if len(body) > MAX_BODY_BYTES:
            raise Rejected(413)
        if not isinstance(signature, str) or not re.fullmatch(r'sha256=[a-f0-9]{64}', signature) or not hmac.compare_digest(sign(self.secret, body), signature):
            raise Rejected(401)
        if content_type.split(';')[0].strip().lower() != 'application/json':
            raise Rejected(415)
        try:
            payload = json.loads(body)
        except (ValueError, UnicodeError, RecursionError):
            raise Rejected(400)
        if not isinstance(payload, dict) or str(payload.get('object', '')).lower() != 'instagram':
            raise Rejected(422)
        entries = payload.get('entry')
        if not isinstance(entries, list) or len(entries) > 100 or any(not isinstance(entry, dict) for entry in entries):
            raise Rejected(400)
        selected = [entry for entry in entries if str(entry.get('id', '')) in self.allowed_ids]
        forwarded = body if len(selected) == len(entries) else json.dumps(
            {**payload, 'entry': selected}, ensure_ascii=False, separators=(',', ':')).encode()
        digest = hashlib.sha256(body).hexdigest()
        with self.lock:
            self.prune_receipts()
            if digest in self.events or (self.receipts / digest).exists():
                return False
            event = {
                'created': time.time(), 'content_type': content_type,
                'hermes_body': base64.b64encode(body).decode(), 'hermes_signature': signature,
                'postiz_body': base64.b64encode(forwarded).decode() if selected else '',
                'postiz_signature': sign(self.secret, forwarded) if selected else '',
                'deliveries': {name: {'state': 'pending', 'attempts': 0, 'next': 0} for name in DESTINATIONS},
            }
            if not selected:
                event['deliveries']['postiz']['state'] = 'skipped'
            size = len(json.dumps(event).encode()) + 32
            if len(self.events) >= self.max_events or sum(item['size'] for item in self.events.values()) + size > self.max_bytes:
                raise Rejected(503)
            event['size'] = size
            atomic_write(self.directory / (digest + '.json'), event)
            self.events[digest] = event
        return True

    def prune_receipts(self):
        now = time.time()
        if now - self.last_pruned < 3600:
            return
        for path in self.receipts.iterdir():
            if path.stat().st_mtime < now - RECEIPT_TTL:
                path.unlink()
        self.last_pruned = now

    def take(self, destination):
        with self.lock:
            for digest, event in self.events.items():
                state = event['deliveries'][destination]
                key = (digest, destination)
                if state['state'] == 'pending' and state['next'] <= time.time() and key not in self.inflight:
                    self.inflight.add(key)
                    return digest, base64.b64decode(event[destination + '_body']), event[destination + '_signature'], event['content_type']
        return None

    def finish(self, digest, destination, status):
        with self.lock:
            event = self.events[digest]
            state = event['deliveries'][destination]
            state['attempts'] += 1
            retryable = status is None or status in (408, 425, 429) or 500 <= status <= 599
            if status is not None and 200 <= status <= 299:
                state['state'] = 'sent'
            elif retryable and state['attempts'] < MAX_ATTEMPTS:
                state['next'] = time.time() + min(3600, 2 ** min(state['attempts'], 12)) + random.uniform(0, 5)
            else:
                state['state'] = 'dead'
                LOG.error('Delivery requires intervention: destination=%s event=%s status=%s attempts=%s', destination, digest, status, state['attempts'])
            state['last_status'] = status
            atomic_write(self.directory / (digest + '.json'), event)
            if all(value['state'] in ('sent', 'skipped') for value in event['deliveries'].values()):
                atomic_write(self.receipts / digest, {'completed': time.time()})
                (self.directory / (digest + '.json')).unlink()
                descriptor = os.open(self.directory, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(descriptor)
                finally:
                    os.close(descriptor)
                del self.events[digest]
            self.inflight.discard((digest, destination))

    def retry_dead(self, digest, destination):
        if not re.fullmatch(r'[a-f0-9]{64}', digest) or destination not in DESTINATIONS:
            raise ValueError('Use an event SHA256 and a known destination')
        with self.lock:
            event = self.events[digest]
            if event['deliveries'][destination]['state'] != 'dead':
                raise ValueError('Only a dead-letter delivery can be retried manually')
            event['deliveries'][destination] = {'state': 'pending', 'attempts': 0, 'next': 0}
            atomic_write(self.directory / (digest + '.json'), event)

    def health(self):
        with self.lock:
            states = [state['state'] for event in self.events.values() for state in event['deliveries'].values()]
            return {'pending': states.count('pending'), 'dead': states.count('dead'),
                    'queued_bytes': sum(item['size'] for item in self.events.values()),
                    'oldest_pending_seconds': round(max((time.time() - event['created'] for event in self.events.values()
                                                        if any(state['state'] == 'pending' for state in event['deliveries'].values())), default=0))}


def request(url, method, body=None, headers=None):
    parsed = urlsplit(url)
    if parsed.scheme == 'https':
        connection = http.client.HTTPSConnection(parsed.hostname, parsed.port or 443, timeout=10, context=ssl.create_default_context())
    elif parsed.scheme == 'http' and parsed.hostname == '127.0.0.1':
        connection = http.client.HTTPConnection(parsed.hostname, parsed.port or 80, timeout=10)
    else:
        raise ValueError('Only verified HTTPS or the local Hermes upstream is supported')
    try:
        connection.request(method, parsed.path + ('?' + parsed.query if parsed.query else ''), body, headers or {})
        response = connection.getresponse()
        result = response.status, response.read(65536), response.getheader('Content-Type', 'application/json')
        return result
    finally:
        connection.close()


def deliver(store, destination, transport=request):
    item = store.take(destination)
    if item is None:
        return False
    digest, body, signature, content_type = item
    status = None
    try:
        status, _, _ = transport(HERMES_URL if destination == 'hermes' else POSTIZ_URL, 'POST', body,
                                 {'Content-Type': content_type, 'X-Hub-Signature-256': signature})
    except (OSError, http.client.HTTPException):
        pass
    store.finish(digest, destination, status)
    return True


class Handler(BaseHTTPRequestHandler):
    server_version = 'InstagramRelay'

    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def log_message(self, *_):
        pass

    def reply(self, status, body=b'', content_type='application/json'):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/health':
            health = self.server.store.health()
            return self.reply(503 if health['dead'] else 200, json.dumps(health).encode())
        if urlsplit(self.path).path != '/webhooks/instagram':
            return self.reply(404)
        try:
            status, body, content_type = request(HERMES_URL + ('?' + urlsplit(self.path).query if urlsplit(self.path).query else ''), 'GET')
            self.reply(status, body, content_type)
        except (OSError, http.client.HTTPException):
            self.reply(503)

    def do_POST(self):
        if urlsplit(self.path).path != '/webhooks/instagram':
            return self.reply(404)
        length = self.headers.get('Content-Length', '')
        if self.headers.get('Transfer-Encoding') or not re.fullmatch(r'\d+', length):
            return self.reply(400)
        if int(length) > MAX_BODY_BYTES:
            return self.reply(413)
        try:
            body = self.rfile.read(int(length))
            if len(body) != int(length):
                return self.reply(400)
            accepted = self.server.store.accept(body, self.headers.get('X-Hub-Signature-256'), self.headers.get('Content-Type', ''))
            self.reply(200, b'{"status":"queued"}' if accepted else b'{"status":"duplicate"}')
        except Rejected as error:
            self.reply(error.status)
        except (OSError, TimeoutError):
            self.reply(503)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 16

    def __init__(self, address, store):
        self.slots = threading.BoundedSemaphore(16)
        self.store = store
        super().__init__(address, Handler)

    def process_request(self, connection, address):
        if not self.slots.acquire(blocking=False):
            connection.close()
            return
        try:
            super().process_request(connection, address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, connection, address):
        try:
            super().process_request_thread(connection, address)
        finally:
            self.slots.release()


def main():
    os.umask(0o077)
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    store = Store(os.environ.get('RELAY_SPOOL', '/data'), Path(os.environ.get('META_APP_SECRET_FILE', '/run/secrets/meta_app_secret')).read_bytes().strip(),
                  [value.strip() for value in os.environ.get('RELAY_INSTAGRAM_IDS', '').split(',') if value.strip()])

    parser = argparse.ArgumentParser()
    parser.add_argument('action', nargs='?', choices=['retry-dead'])
    parser.add_argument('event', nargs='?')
    parser.add_argument('destination', nargs='?', choices=DESTINATIONS)
    arguments = parser.parse_args()
    if arguments.action:
        store.retry_dead(arguments.event or '', arguments.destination)
        store.close()
        return

    def worker(destination):
        while True:
            try:
                if not deliver(store, destination):
                    time.sleep(1)
            except Exception as error:
                # A failed durable write is not acknowledged; restart retries the pending delivery.
                LOG.critical('Delivery worker stopped: destination=%s error_type=%s', destination, type(error).__name__)
                os._exit(1)

    for destination in DESTINATIONS:
        threading.Thread(target=worker, args=(destination,), daemon=True).start()
    Server(('127.0.0.1', 15038), store).serve_forever()


if __name__ == '__main__':
    main()
