require('dotenv').config();


const TelegramBot = require("node-telegram-bot-api");
const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token, {polling: true});


const defaultGameState = {
    active: false,
    word: "",
    firstLetter: "",
    revealedLetters: "",
    thinker: null,
    // players: new Set(),
    contactWordMap: new Map(),
    timer: null,
    currentContactId: 0,
    activeContactId: null,
    //contact id, users array
    contactUsersMap: new Map(),
};

const chatGameMap = new Map()

// commands
bot.setMyCommands([
    {command: '/start_bot', description: 'Почати гру'},
    {command: '/start_game', description: 'Почати гру'},
    {command: '/zahadaty', description: 'Загадати слово'},
    {command: '/rules', description: 'Правила'},
    {command: '/game', description: 'Игра угадай цифру'},
])

function clearGameState(chatId) {
    let gameState = chatGameMap.get(chatId)
    gameState.active = false;
    gameState.word = "";
    gameState.firstLetter = "";
    gameState.revealedLetters = "";
    // gameState.players.clear();
    //user_id: {contact_id, word}
    gameState.thinker = null;
    gameState.contactWordMap.clear();
    gameState.timer = null;
    gameState.currentContactId = 0;
    gameState.activeContactId = null;
    gameState.contactUsersMap.clear();

}

function clearContact(gameState){
    clearTimeout( gameState.timer)
    gameState.timer = null;
    gameState.contactUsersMap.delete(gameState.activeContactId);
    gameState.activeContactId = null;
    gameState.contactWordMap.clear();
}

bot.onText(/\/start_bot/, async (message) => {
    const isPrivate = (!message.chat.type === "private");
    if (isPrivate) {
        return await bot.sendMessage(message.chat.id, "Тепер ти можеш брати участь в іграх")
    }
    return await bot.sendMessage(message.chat.id, "Це команда для особистого чату")
})

// Старт гри
bot.onText(/\/start_game/, async (msg) => {
    const chatId = msg.chat.id
    const isPrivate = (!message.chat.type === "private");
    if (isPrivate) return
    let gameState = chatGameMap.set(chatId, defaultGameState);
    if (gameState.active) return bot.sendMessage(msg.chat.id, "Гра вже йде!");
    clearGameState(chatId);
    chatGameMap.set(chatId, gameState);
    await bot.sendMessage(chatId, "🔮 Хто загадає слово? Натисніть /zahadaty");
});

// Гравець загадує слово
bot.onText(/\/zahadaty/, async (msg) => {
    const isPrivate = (!message.chat.type === "private");
    if (isPrivate) return;
    const chatId = msg.chat.id;
    let gameState = chatGameMap.get(chatId);
    if (!gameState.active) return bot.sendMessage(chatId, "Гра ще не почалась! Натисни /start_game");

    const userId = msg.from.id;
    if (gameState.thinker) return bot.sendMessage(chatId, "Загадувач вже вибраний!");

    gameState.thinker = userId;
    await bot.sendMessage(userId, "🤫 Введи слово, яке треба загадати. (Це повідомлення в особистому чаті)");
});

function getChatIdByThinker(userId) {
    for (let [gameId, gameState] of chatGameMap) {
        if (gameState.thinker === userId) {
            return gameState.chatId;  // Повертає chatId групи, де thinker це userId
        }
    }
    return null;  // Якщо thinker не знайдений для цього userId
}

bot.on('message', async (msg) => {

    const isPrivate = (!msg.chat.type === "private");
    if (!isPrivate) return;
    const personalChatId = msg.chat.id;
    const userId = msg.from.id;
    const groupChatId = getChatIdByThinker(userId);
    let gameState = chatGameMap.get(groupChatId);
    if (!gameState || !gameState.active) return;

    gameState.word = msg.text.toLowerCase();
    gameState.firstLetter = gameState.word[0].toUpperCase();
    gameState.revealedLetters = gameState.firstLetter;

    await bot.sendMessage(personalChatId, "✅ Слово збережено! Повідом друзів, що гра почалась.");
    await bot.sendMessage(groupChatId, `Перша буква: *${gameState.firstLetter}*`, {parse_mode: "Markdown"});
})

function getUsernamesByIDs(chatId, ids) {
    let usernames= []
    for (let userId in ids)
    {
        bot.getChatMember(chatId, userId)
            .then(chatMember => {
                const username = chatMember.user.username;
                usernames.push(username);
            }) ;
    }
    return usernames;
}

// Обробка "є контакт"
bot.onText(/^\/contact\s+\w+/, async (msg) => {
    const isPrivate = (!msg.chat.type === "private");
    if (isPrivate) return;
    const chatId = msg.chatId;
    const userId = msg.from.id;
    let gameState = chatGameMap.get(chatId);
    if(gameState.activeContactId) {
        await bot.sendMessage(chatId, "2 інші людини вже контактують! Зачекай своєї черги)");
        return;
    }
    if (!gameState.active || !msg.text) return;
    const contactId = gameState.currentContactId;
    let activeContactUsers;
    for (let [contactId, userIds] of gameState.contactUsersMap) {
        if(userIds.has(msg.reply_to_message.from.id)) {
            gameState.activeContactId = contactId;
            userIds.push(userId);
            gameState.contactUsersMap.set(contactId, userIds)
            activeContactUsers = userIds
        };
    }

    if(!gameState.active) {
        gameState.contactUsersMap.set(contactId, userId);
        return;
    }

    gameState.contactWordMap.set(activeContactUsers[0], null);
    gameState.contactWordMap.set(activeContactUsers[1], null);

    let keys = Array.from(gameState.contactWordMap.keys());
    let usernames = getUsernamesByIDs(chatId, keys);
    if (gameState.contactWordMap.size === 2) {
        await bot.sendMessage(chatId, `${usernames[0]} i ${usernames[0]} - у вас контакт!. Пишіть слово мені в особисті)`);
        await bot.sendMessage(keys[0], `Я тут! Пиши слово`);
        await bot.sendMessage(keys[1], `Я тут! Пиши слово`);
        await bot.sendMessage(chatId, "🕐 Відлік: 5... 4... 3... 2... 1...");
        gameState.timer = setTimeout(() => {
            bot.sendMessage(chatId, "⌛ Час вийшов... Не всі контакти написали слово ..");
            clearContact()
        }, 5000);
    }
})

bot.on("message", async (msg) => {
    const userId = msg.from.id;
    if (userId !== gameState.thinker) return;
    const isPrivate = (!msg.chat.type === "private");
    if (isPrivate) return;
    const chatId = msg.chat.id;
    let gameState = chatGameMap.get(chatId);
    if (!gameState.active || !msg.text) return;
    const contactWords = Array.from(gameState.contactWordMap.values());
    if (gameState.timer !== null && (msg.text === contactWords[0] || msg.text === contactWords[1])) {
        clearContact()
        gameState.contactUsersMap.delete(gameState.activeContactId);
        await bot.sendMessage(chatId, "❌ Загадувач перебив відгадування! Нова буква не буде додана.");
    }
})

function checkContactCorrectness(contactWords, revealedLetters) {
    if (!contactWords[0] === contactWords[1]) return false;
    if (!contactWords[0].startsWith(revealedLetters.toLowerCase())) return false;
    return true;
}

// bot on message в пп від контактерів
bot.on("message", async (msg) => {
    const isPrivate = (!msg.chat.type === "private");
    if (!isPrivate) return;
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    let gameState = chatGameMap.get(chatId);
    if(!gameState.timer) return;
    if (!gameState.contactWordMap.has(userId)) return;
    if (gameState.contactWordMap.get(userId) !== null) return
    gameState.contactWordMap.set(userId, msg.text.toLowerCase());
    gameState.amountOfReadyContacters += 1;
    if (gameState.amountOfReadyContacters === 2) {
        const isCorrect = checkContactCorrectness(gameState.revealedLetters, Array.from(gameState.contactWordMap.values()))
        if (isCorrect && gameState.timer) {
            clearContact()
            gameState.revealedLetters = gameState.word.substring(0, gameState.revealedLetters.length + 1);
            await bot.sendMessage(chatId, `📝 Нова буква: *${gameState.revealedLetters}*`, {parse_mode: "Markdown"});
        }
        if (gameState.revealedLetters.length === gameState.word.length) {
            await bot.sendMessage(chatId, "🎉 Вітаємо! Слово відгадане! Гра завершена.");
            clearGameState(gameState);
        }
        gameState.contactWordMap.clear();
    }
})

bot.on("message", async (msg) => {
    const isPrivate = (!msg.chat.type === "private");
    if (isPrivate) return;
    const chatId = msg.chat.id;
    let gameState = chatGameMap.get(chatId);
    if(msg.text === gameState.word) {
        await bot.sendMessage(chatId, "🎉 Вітаємо! Слово відгадане! Гра завершена.");
        clearGameState(chatId);
    }

})
