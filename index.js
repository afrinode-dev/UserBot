const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const { Api } = require('telegram/tl');
const input = require('input');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

// Configuration
const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;
const destChatId = process.env.DEST_CHAT;
const adminId = parseInt(process.env.ADMIN_ID);
const bannerUrl = process.env.BANNER_URL || 'https://raw.githubusercontent.com/afrinode-dev/UserBot/refs/heads/main/bot.png';

// Gestion des sources
let sources = process.env.SOURCES ? process.env.SOURCES.split(',').map(id => id.trim()) : [];
const sessionFile = path.join(__dirname, '.session');
const sourcesFile = path.join(__dirname, 'sources.json');

async function loadSources() {
  try {
    const data = await fs.readFile(sourcesFile, 'utf8');
    sources = JSON.parse(data);
    console.log('Sources loaded:', sources);
  } catch (error) {
    console.log('No sources file found, using .env sources');
    await saveSources();
  }
}

async function saveSources() {
  try {
    await fs.writeFile(sourcesFile, JSON.stringify(sources));
    console.log('Sources saved:', sources);
  } catch (error) {
    console.error('Error saving sources:', error);
  }
}

// Session
const stringSession = new StringSession('');
async function loadSession() {
  try {
    const sessionData = await fs.readFile(sessionFile, 'utf8');
    return new StringSession(sessionData);
  } catch (error) {
    console.log('No session file found, creating new session');
    return new StringSession('');
  }
}

async function saveSession(session) {
  try {
    await fs.writeFile(sessionFile, session.save());
    console.log('Session saved successfully');
  } catch (error) {
    console.error('Error saving session:', error);
  }
}

// Client Telegram
let client;
let isForwarding = true;

async function initClient() {
  const session = await loadSession();
  client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await input.text('Please enter your number: '),
    password: async () => await input.text('Please enter your password: '),
    phoneCode: async () => await input.text('Please enter the code you received: '),
    onError: (err) => console.log(err),
  });

  await saveSession(client.session);
  console.log('Client initialized and connected');

  // Setup event handlers
  setupHandlers();
}

function setupHandlers() {
  // Handler for new messages in source chats
  client.addEventHandler(async (event) => {
    if (!isForwarding) return;
    
    const message = event.message;
    if (!sources.includes(String(message.chatId))) return;

    const hasMedia = message.photo || message.video || message.audio || message.document;
    if (hasMedia) {
      try {
        await client.forwardMessages(destChatId, {
          messages: [message.id],
          fromPeer: message.chatId
        });
        console.log(`Forwarded message ${message.id} from group ${message.chatId}`);
      } catch (error) {
        console.error('Error forwarding message:', error);
      }
    }
  }, new NewMessage({}));

  // Handler for commands
  client.addEventHandler(async (event) => {
    const message = event.message;
    if (message.senderId?.toString() !== adminId.toString()) return;
    if (!message.message) return;

    const text = message.message;
    
    if (text.startsWith('/menu')) {
      await showMenu(message);
    } else if (text.startsWith('/addsource')) {
      await addSource(message);
    } else if (text.startsWith('/removesource')) {
      await removeSource(message);
    } else if (text.startsWith('/listsources')) {
      await listSources(message);
    } else if (text.startsWith('/startforward')) {
      isForwarding = true;
      await message.reply({ message: 'Forwarding started' });
    } else if (text.startsWith('/stopforward')) {
      isForwarding = false;
      await message.reply({ message: 'Forwarding stopped' });
    }
  }, new NewMessage({}));
}

// Command implementations
async function showMenu(message) {
  const buttons = [
    [
      { text: 'Ajouter source', callbackData: 'add_source' },
      { text: 'Supprimer source', callbackData: 'remove_source' }
    ],
    [
      { text: 'Lister sources', callbackData: 'list_sources' },
      { text: isForwarding ? 'Stopper forward' : 'Démarrer forward', callbackData: 'toggle_forward' }
    ]
  ];

  try {
    await client.sendMessage(message.chatId, {
      message: 'Menu de gestion du userbot:',
      file: bannerUrl,
      buttons: buttons,
      parseMode: 'html'
    });
  } catch (error) {
    console.error('Error showing menu:', error);
  }
}

async function addSource(message) {
  const chatId = message.message.split(' ')[1];
  if (!chatId) {
    await message.reply({ message: 'Usage: /addsource <chat_id>' });
    return;
  }

  if (sources.includes(chatId)) {
    await message.reply({ message: 'Cette source est déjà dans la liste' });
    return;
  }

  sources.push(chatId);
  await saveSources();
  await message.reply({ message: `Source ${chatId} ajoutée avec succès` });
}

async function removeSource(message) {
  const chatId = message.message.split(' ')[1];
  if (!chatId) {
    await message.reply({ message: 'Usage: /removesource <chat_id>' });
    return;
  }

  const index = sources.indexOf(chatId);
  if (index === -1) {
    await message.reply({ message: 'Cette source n\'est pas dans la liste' });
    return;
  }

  sources.splice(index, 1);
  await saveSources();
  await message.reply({ message: `Source ${chatId} supprimée avec succès` });
}

async function listSources(message) {
  if (sources.length === 0) {
    await message.reply({ message: 'Aucune source configurée' });
    return;
  }

  const sourcesList = sources.map((source, index) => `${index + 1}. ${source}`).join('\n');
  await message.reply({ message: `Sources configurées:\n${sourcesList}` });
}

// Callback query handler
client.addEventHandler(async (event) => {
  const query = event;
  const data = query.data;
  const userId = query.userId;

  if (userId.toString() !== adminId.toString()) {
    await query.answer({ message: 'Unauthorized' });
    return;
  }

  if (data === 'add_source') {
    await query.answer({ message: 'Utilisez /addsource <chat_id>' });
  } else if (data === 'remove_source') {
    await query.answer({ message: 'Utilisez /removesource <chat_id>' });
  } else if (data === 'list_sources') {
    await listSources({ reply: async (obj) => {
      await client.sendMessage(query.chatId, obj);
    }});
  } else if (data === 'toggle_forward') {
    isForwarding = !isForwarding;
    await query.answer({ message: `Forwarding ${isForwarding ? 'started' : 'stopped'}` });
  }
}, new CallbackQuery({}));

// Initialisation
async function main() {
  await loadSources();
  await initClient();
}

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  if (client) {
    await client.disconnect();
  }
  process.exit(0);
});

main().catch(console.error);
