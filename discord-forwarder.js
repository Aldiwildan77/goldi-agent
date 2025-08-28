import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
} from 'discord.js';
import 'dotenv/config';

import { randomBytes } from 'crypto';

const {
  DISCORD_TOKEN,
  N8N_WEBHOOK_URL,
  ALSO_FORWARD_DMS = 'false',
  BOT_ID,
} = process.env;

if (!DISCORD_TOKEN || !N8N_WEBHOOK_URL) {
  console.error('Missing DISCORD_TOKEN or N8N_WEBHOOK_URL in env');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

async function postWithRetry(url, body, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      return await res.json().catch(() => ({}));
    } catch (err) {
      lastErr = err;
      const backoff = 300 * (i + 1);
      await new Promise(r => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag} (${c.user.id})`);

  // Set bot presence/status
  c.user.setPresence({
    status: 'online',
    activities: [{
      name: 'ya',
      type: ActivityType.Listening,
    }],
    afk: false,
  });
});

client.on(Events.MessageCreate, async (message) => {
  const botId = BOT_ID;
  try {
    if (message.author?.bot && message.author?.id == botId) return;

    const isDM = message.channel?.isDMBased?.();
    if (isDM && ALSO_FORWARD_DMS.toLowerCase() !== 'true') return;

    const mentioned = message.mentions?.has(client.user);
    const mentionedThroughServer = message.content.includes(`<@${botId}>`);
    if (!mentioned && !isDM && !mentionedThroughServer) return;

    const attachments = [...(message.attachments?.values?.() ?? [])].map(a => ({
      id: a.id,
      name: a.name,
      size: a.size,
      url: a.url,
      contentType: a.contentType || null,
    }));

    const mentions = {
      users: [...(message.mentions?.users?.values?.() ?? [])].map(u => ({
        id: u.id, username: u.username, globalName: u.globalName || null
      })),
      roles: [...(message.mentions?.roles?.values?.() ?? [])].map(r => ({ id: r.id, name: r.name })),
      everyone: Boolean(message.mentions?.everyone),
    };

    const payload = {
      messageId: message.id,
      channelId: message.channelId,
      guildId: message.guildId || null,
      isDM,
      author: {
        id: message.author.id,
        username: message.author.username,
        globalName: message.author.globalName || null,
      },
      content: message.content || '',
      mentionedBot: Boolean(mentioned),
      createdAt: message.createdAt?.toISOString?.() || null,
      attachments,
      mentions,
      sessionId: randomBytes(16).toString('hex'), // for agent memory
    };

    const result = await postWithRetry(N8N_WEBHOOK_URL, payload);

    if (result?.reply) {
      await message.reply(String(result.reply).slice(0, 1800)); // guard length
    }
  } catch (err) {
    console.error('Error forwarding message:', err);
  }
});

client.login(DISCORD_TOKEN);