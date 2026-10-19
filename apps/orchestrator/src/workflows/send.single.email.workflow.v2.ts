import { proxyActivities } from '@temporalio/workflow';
import { EmailActivity } from '@gitroom/orchestrator/activities/email.activity';
import { SendEmail } from '@gitroom/orchestrator/signals/send.email.signal';
import { emailQueues } from '@gitroom/nestjs-libraries/temporal/email.queues';

const { sendEmail: sendPriorityEmail } = proxyActivities<EmailActivity>({
  startToCloseTimeout: '10 minute',
  taskQueue: emailQueues.priority.taskQueue,
  cancellationType: 'ABANDON',
});

const { sendEmail: sendBulkEmail } = proxyActivities<EmailActivity>({
  startToCloseTimeout: '10 minute',
  taskQueue: emailQueues.bulk.taskQueue,
  cancellationType: 'ABANDON',
});

export async function sendSingleEmailWorkflowV2(email: SendEmail) {
  const send = email.addTo === 'top' ? sendPriorityEmail : sendBulkEmail;
  await send(email.to, email.subject, email.html, email.replyTo, email.lang);
}
