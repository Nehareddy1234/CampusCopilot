export interface NotificationChannel {
  readonly name: string;
  send(message: string): Promise<void>;
}

export class ConsoleChannel implements NotificationChannel {
  readonly name = 'console';
  async send(message: string): Promise<void> {
    console.log(message);
  }
}

export class GoogleChatChannel implements NotificationChannel {
  readonly name = 'google-chat';

  constructor(private webhookUrl: string) {}

  async send(message: string): Promise<void> {
    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message })
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Google Chat send failed (HTTP ${response.status}): ${body}`);
    }
  }
}

export function createChannelFromEnv(env: NodeJS.ProcessEnv = process.env): NotificationChannel {
  const kind = (env.ALERT_CHANNEL || 'console').toLowerCase().replace(/[\s_-]/g, '');
  if (kind === 'googlechat' || kind === 'chat') {
    const webhookUrl = env.GOOGLE_CHAT_WEBHOOK_URL || '';
    if (!webhookUrl.startsWith('https://chat.googleapis.com/')) {
      throw new Error('ALERT_CHANNEL=googlechat requires GOOGLE_CHAT_WEBHOOK_URL (an incoming webhook URL from a Google Chat space)');
    }
    return new GoogleChatChannel(webhookUrl);
  }
  return new ConsoleChannel();
}
