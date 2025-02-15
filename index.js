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
    currentContactId: 1,
    activeContactId: null,
    //contact id, users array
    contactUsersMap: new Map(),
};
//chatid, gameid
const chatGameMap = new Map()

//chatid, userid
const userChatMap = new Map()
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
    if (gameState.contactWordMap) gameState.contactWordMap.clear();
    gameState.timer = null;
    gameState.currentContactId = 1;
    gameState.activeContactId = null;
    if (gameState.contactUsersMap) gameState.contactUsersMap.clear();
    chatGameMap.set(chatId, gameState);
}

// set default state for new chat
bot.on('message', async (message) => {
    const isPrivate = (message.chat.type === "private");
    if (isPrivate) return;
    const chatId = message.chat.id
    let gameState = chatGameMap.get(chatId);
    if (!gameState) {
        defaultGameState.contactUsersMap = new Map()
        chatGameMap.set(chatId, defaultGameState);
    }
})

function clearContact(chatId, gameState) {
    if(gameState.timer) clearTimeout(gameState.timer)
    gameState.timer = null;
    gameState.contactUsersMap.delete(gameState.activeContactId);
    gameState.activeContactId = null;
    gameState.contactWordMap.clear();
    chatGameMap.set(chatId, gameState);
}


bot.onText(/\/start_bot/, async (message) => {
    const isPrivate = (message.chat.type === "private");
    if (isPrivate) {
        return await bot.sendMessage(message.chat.id, "Тепер ти можеш брати участь в іграх")
    }
    return await bot.sendMessage(message.chat.id, "Це команда для особистого чату")
})

// Старт гри
bot.onText(/\/start_game/, async (message) => {
    const chatId = message.chat.id
    const isPrivate = (message.chat.type === "private");
    if (isPrivate) return
    let gameState = chatGameMap.set(chatId, defaultGameState);
    if (gameState.active) return bot.sendMessage(message.chat.id, "Гра вже йде!");
    clearGameState(chatId);
    chatGameMap.set(chatId, gameState);
    gameState.active = true;
    chatGameMap.set(chatId, gameState);
    await bot.sendMessage(chatId, "🔮 Хто загадає слово? Натисніть /zahadaty");
});

// Гравець загадує слово
bot.onText(/\/zahadaty/, async (message) => {
    const isPrivate = (message.chat.type === "private");
    if (isPrivate) return;
    const userId = message.from.id;
    const chatId = message.chat.id;
    let gameState = chatGameMap.get(chatId);
    if (!gameState.active) return bot.sendMessage(chatId, "Гра ще не почалась! Натисни /start_game");

    if (gameState.thinker) return bot.sendMessage(chatId, "Загадувач вже вибраний!");

    gameState.thinker = userId;
    chatGameMap.set(chatId, gameState);
    try {
        await bot.sendMessage(userId, "🤫 Введи слово, яке треба загадати. (Це повідомлення в особистому чаті)");
    } catch (error) {
        await bot.sendMessage(chatId, "🤫 ЗАЙДИ В БОТА И НАЖМИИ СТАРТБОТ, ТОГДА ЗАГАДЕШЬ");
    }
});

function getChatIdByThinker(userId) {
    for (let [gameId, gameState] of chatGameMap) {
        if (gameState.thinker === userId) {
            return gameId;  // Повертає chatId групи, де thinker це userId
        }
    }
    return null;  // Якщо thinker не знайдений для цього userId
}

bot.on('message', async (message) => {

    const isPrivate = (message.chat.type === "private");
    if (!isPrivate) return;
    const personalChatId = message.chat.id;
    const userId = message.from.id;
    const groupChatId = getChatIdByThinker(userId);
    let gameState = chatGameMap.get(groupChatId);

    if (!gameState || !gameState.active) return;

    gameState.word = message.text.toLowerCase();
    gameState.firstLetter = gameState.word[0].toUpperCase();
    gameState.revealedLetters = gameState.firstLetter;
    chatGameMap.set(groupChatId, gameState);

    await bot.sendMessage(personalChatId, "✅ Слово збережено! Повідом друзів, що гра почалась.");
    await bot.sendMessage(groupChatId, `Перша буква: *${gameState.firstLetter}*. ВВеди команду 
    /contact пояснення слова, щоб інші могли сконтактувати з тобою `, {parse_mode: "Markdown"});
})

function getUsernamesByIDs(chatId, ids) {
    try {
        let usernames = []
        console.log("ids getUsernamesByIDs", ids)
        for (let userId in ids) {
            bot.getChatMember(chatId, userId)
                .then(chatMember => {
                    console.log("chat member", chatMember);
                    const username = chatMember.user.username;
                    usernames.push(username);
                });
        }
        return usernames;
    } catch (e) {
        console.log("getUsernamesByIDs misfunction")
    }
}

// Обробка "є контакт"

bot.onText(/^\/contact(?:\s+.+)?$/, async (message) => {
    console.log("contact")
    const isPrivate = (message.chat.type === "private");
    if (isPrivate) return;
    const chatId = message.chat.id;
    const userId = message.from.id;
    let gameState = chatGameMap.get(chatId);
    if (!gameState || !gameState.active || !message.text) {
        await bot.sendMessage(chatId, "Гра ще не почалась! Натисни /start_game ");
        return;
    }
    //Закоментовано в цілях тестування
    // if(userId === gameState.thinker) {
    //     await bot.sendMessage(chatId, "Загадувач не може брати участь у контакті");
    //     return;
    // }

    if (gameState.activeContactId != null) {
        await bot.sendMessage(chatId, "2 інші людини вже контактують! Зачекай своєї черги)");
        return;
    }
    if (!gameState.currentContactId) gameState.currentContactId = 1;
    const contactId = gameState.currentContactId;
    let activeContactUsers;
    if (!gameState.contactUsersMap) gameState.contactUsersMap = new Map();
    console.log("map", gameState.contactUsersMap);
    for (let [contactId, userIds] of gameState.contactUsersMap) {
        // додати перевірку на те щоб користувача ще там не було)
        if (!message.reply_to_message.from) continue
        if (userIds.includes(message.reply_to_message.from.id)) {
            gameState.activeContactId = contactId;
            userIds.push(userId);
            gameState.contactUsersMap.set(contactId, userIds)
            activeContactUsers = userIds
            await bot.sendMessage(chatId, `Є контакт`);
            userChatMap.set(userId, chatId);
        }
    }

    gameState.currentContactId++;
    console.log("activeContactId", gameState.activeContactId)
    if (!gameState.activeContactId) {
        gameState.contactUsersMap.set(contactId, [userId]);
        await bot.sendMessage(chatId, "Чекай поки хтось з тобою сконтактує! (введе команду /contact)");
        chatGameMap.set(chatId, gameState);
        userChatMap.set(userId, chatId);
        return;
    }

    if(!gameState.contactWordMap) gameState.contactWordMap = new Map();
    gameState.contactWordMap.set(activeContactUsers[0], null);
    gameState.contactWordMap.set(activeContactUsers[1], null);
    console.log("Active contacts", activeContactUsers[0], activeContactUsers[1])
    let keys = Array.from(gameState.contactWordMap.keys());
    let usernames = getUsernamesByIDs(chatId, keys);
    await bot.sendMessage(chatId, `${usernames[0]} i ${usernames[0]} - у вас контакт!. Пишіть слово мені в особисті)`);
    try {
        await bot.sendMessage(keys[0], `Я тут! Пиши слово`);
        await bot.sendMessage(keys[1], `Я тут! Пиши слово`);
    } catch (e) {
        await bot.sendMessage(chatId, `${usernames[0]} i ${usernames[0]} - ви обидва маєте ініціювати контакт з ботом, щоб грати!
        Контакт скасовано!`);
        clearContact(gameState);
    }
    await bot.sendMessage(chatId, "🕐 Відлік: 5... 4... 3... 2... 1...");
    gameState.timer = setTimeout(() => {
        bot.sendMessage(chatId, "⌛ Час вийшов... Не всі контакти написали слово ..");
        clearContact(chatId, gameState)
    }, 5000);

    chatGameMap.set(chatId, gameState);

})

bot.on("message", async (message) => {


    const isPrivate = (message.chat.type === "private");
    if (isPrivate) return;
    const chatId = message.chat.id;
    let gameState = chatGameMap.get(chatId);
    if (!gameState) return;
    const userId = message.from.id;
    if (userId !== gameState.thinker) return;
    if (!gameState.active || !message.text) return;
    if (!gameState.contactWordMap) return;
    const contactWords = Array.from(gameState.contactWordMap.values());
    if (gameState.timer !== null && (message.text === contactWords[0] || message.text === contactWords[1])) {
        clearContact(chatId, gameState);
        gameState.contactUsersMap.delete(gameState.activeContactId);
        await bot.sendMessage(chatId, "❌ Загадувач перебив відгадування! Нова буква не буде додана.");
    }
    chatGameMap.set(chatId, gameState);

})

function checkContactCorrectness(contactWords, revealedLetters) {
    if (!contactWords[0] === contactWords[1]) return false;
    if (!contactWords[0].startsWith(revealedLetters.toLowerCase())) return false;
    return true;
}

// bot on message в пп від контактерів
bot.on("message", async (message) => {
    const isPrivate = (message.chat.type === "private");
    if (!isPrivate) return;
    const userId = message.from.id;
    const personalChatId = message.chat.id
    const groupChatId = userChatMap.get(userId);
    let gameState = chatGameMap.get(groupChatId);
    if (!gameState) return;
    if (!gameState.timer) return;
    if (!gameState.contactWordMap.has(userId)) return;
    if (gameState.contactWordMap.get(userId) !== null) return
    gameState.contactWordMap.set(userId, message.text.toLowerCase());
    await bot.sendMessage(personalChatId, "Слово зафіксовано! Тепер побачимо чи у вас стався збіг ...");
    gameState.amountOfReadyContacters += 1;
    if (gameState.amountOfReadyContacters === 2) {
        console.log("input value array", Array.from(gameState.contactWordMap.values()))
        const isCorrect = checkContactCorrectness(gameState.revealedLetters, Array.from(gameState.contactWordMap.values()))
        if (isCorrect && gameState.timer) {
            clearContact(groupChatId, gameState);
            gameState.revealedLetters = gameState.word.substring(0, gameState.revealedLetters.length + 1);
            await bot.sendMessage(groupChatId, `📝 Нова буква: *${gameState.revealedLetters}*`, {parse_mode: "Markdown"});
        }
        if (gameState.revealedLetters.length === gameState.word.length) {
            await bot.sendMessage(groupChatId, "🎉 Вітаємо! Слово відгадане! Гра завершена.");
            clearGameState(gameState);
        }
        if(!isCorrect) {
            await bot.sendMessage(groupChatId, "На жаль користувачі ввели різні слова(. Нова буква не буде відкрита");
        }
        gameState.contactWordMap.clear();
    }
    chatGameMap.set(chatId, gameState);

})

bot.on("message", async (message) => {
    const isPrivate = (message.chat.type === "private");
    if (isPrivate) return;
    const chatId = message.chat.id;
    let gameState = chatGameMap.get(chatId);
    if (!gameState) return;
    if (!gameState.active || !message.text) return;
    if (message.text === gameState.word) {
        await bot.sendMessage(chatId, "🎉 Вітаємо! Слово відгадане! Гра завершена.");
        clearGameState(chatId);
    }

})
