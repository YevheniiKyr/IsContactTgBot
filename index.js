require('dotenv').config();


const TelegramBot = require("node-telegram-bot-api");
const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token, {polling: true});

const Role = Object.freeze({
    THINKER: "thinker",
    CONTACTOR: "contactor",
    NONE: null
});

const defaultGameState = {
    active: false,
    word: "",
    firstLetter: "",
    revealedLetters: "",
    thinker: null,
    contactWordMap: new Map(),
    contactorsTimer: null,
    currentContactId: 1,
    activeContactId: null,
    thinkerTimer: null
    //contact id, users array
    // contactUsersMap: new Map(),
};
//chatid, gameid
const chatGameMap = new Map()

//userid, chatid-- it is map because user can only play in one game simultaneously
const userChatMap = new Map()
// role can be contacter, thinker or null
const userRoleMap = new Map()

// commands
bot.setMyCommands([
    {command: '/start_bot', description: 'Почати гру'},
    {command: '/start_game', description: 'Почати гру'},
    {command: '/zahadaty', description: 'Загадати слово'},
    {command: '/rules', description: 'Правила'},
    {command: '/game', description: 'Игра угадай цифру'},
])

function clearGameState(chatId) {
    let gameState = deepCopyDefaultState()
    chatGameMap.set(chatId, gameState);
}

function deepCopyDefaultState() {
    return structuredClone(defaultGameState)
}

async function thinkerMakesWord(gameState, messageText, userId, groupChatId) {
    if (gameState.word !== "") return
    gameState.word = messageText.toLowerCase();
    gameState.firstLetter = gameState.word[0].toUpperCase();
    gameState.revealedLetters = gameState.firstLetter;
    chatGameMap.set(groupChatId, gameState);

    await bot.sendMessage(userId, "✅ Слово збережено! Повідом друзів, що гра почалась.");
    await bot.sendMessage(groupChatId, `Перша буква: *${gameState.firstLetter}*. ВВеди команду 
    /contact пояснення слова, щоб інші могли сконтактувати з тобою `, {parse_mode: "Markdown"});

}

function setRoles(userIds, role) {
    for (let userId in userIds)
        userRoleMap.set(userId, role);
}

async function contacterWritesWord(gameState, messageText, userId, groupChatId) {
    if (!gameState.contactWordMap.has(userId)) return;
    if (gameState.contactWordMap.get(userId) !== null) return
    gameState.contactWordMap.set(userId, messageText.toLowerCase());
    await bot.sendMessage(userId, "Слово зафіксовано! Тепер побачимо чи у вас стався збіг ...");
    gameState.amountOfReadyContacters += 1;
    if (gameState.amountOfReadyContacters === 2) {
        console.log("input value array", Array.from(gameState.contactWordMap.values()))
        const isCorrect = checkContactCorrectness(gameState.revealedLetters, Array.from(gameState.contactWordMap.values()))
        if (isCorrect) {
            gameState.revealedLetters = gameState.word.substring(0, gameState.revealedLetters.length + 1);
            await bot.sendMessage(groupChatId, `📝 Нова буква: *${gameState.revealedLetters}*`, {parse_mode: "Markdown"});
        }
        if (gameState.revealedLetters.length === gameState.word.length) {
            await bot.sendMessage(groupChatId, "🎉 Вітаємо! Слово відгадане! Гра завершена.");
            clearGameState(groupChatId);
        }
        if (!isCorrect) {
            await bot.sendMessage(groupChatId, "На жаль користувачі ввели різні слова(. Нова буква не буде відкрита");
        }
        clearContact(gameState);
        setRoles(Array.from(gameState.contactWordMap.keys()), Role.NONE)
    }
    chatGameMap.set(groupChatId, gameState);
}

async function registerContact(gameState, userId, chatId, message) {
    let activeContactUsers;
    for (let [contactId, userIds] of gameState.contactUsersMap) {
        // додати перевірку на те, щоб користувача ще там не було)
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
    return activeContactUsers;
}

async function initiateContact(gameState, userId, chatId) {
    gameState.currentContactId++;
    gameState.contactUsersMap.set(gameState.currentContactId, [userId]);
    await bot.sendMessage(chatId, "Чекай поки хтось з тобою сконтактує! (введе команду /contact)");
    chatGameMap.set(chatId, gameState);
    userChatMap.set(userId, chatId);
}

async function notifyContacters(gameState, activeContactUsers, chatId) {
    let notified = true
    gameState.contactWordMap.set(activeContactUsers[0], null);
    gameState.contactWordMap.set(activeContactUsers[1], null);
    console.log("Active contacts", activeContactUsers[0], activeContactUsers[1])
    let keys = Array.from(gameState.contactWordMap.keys());
    let usernames = getUsernamesByIDs(chatId, keys);
    await bot.sendMessage(chatId, `${usernames[0]} i ${usernames[0]} - у вас контакт!. Пишіть слово мені в особисті)`);
    try {
        await bot.sendMessage(keys[0], `Я тут! Пиши слово`);
        await bot.sendMessage(keys[1], `Я тут! Пиши слово`);
        clearContact(chatId, activeContactUsers)
    } catch (e) {
        notified = false;
        await bot.sendMessage(chatId, `${usernames[0]} i ${usernames[0]} - ви обидва маєте ініціювати контакт з ботом, щоб грати!
        Контакт скасовано!`);
        clearContact(chatId, activeContactUsers);
    }
    return notified;
}

async function setTimerForContacters(chatId, gameState) {
    await bot.sendMessage(chatId, "🕐 Відлік: 5... 4... 3... 2... 1...");
    gameState.timer = setTimeout(() => {
        bot.sendMessage(chatId, "⌛ Час вийшов... Не всі контакти написали слово ..");
        clearContact(chatId)
    }, 5000);
}

async function contact(gameState, message, chatId) {
    const userId = message.from.id;
    if (!gameState || !gameState.active || !message.text) {
        await bot.sendMessage(chatId, "Гра ще не почалась! Натисни /start_game ");
        return;
    }
    if (gameState.activeContactId != null) {
        await bot.sendMessage(chatId, "2 інші людини вже контактують! Зачекай своєї черги)");
        return;
    }
    // Закоментовано в цілях тестування
    // if (userId === gameState.thinker) {
    //     await bot.sendMessage(chatId, "Загадувач не може брати участь у контакті");
    //     return;
    // }

    let activeContactUsers = await registerContact(gameState, userId, chatId, message);
    console.log("activeContactId", gameState.activeContactId)
    if (!gameState.activeContactId) {
        return await initiateContact(gameState, userId, chatId);
    }

    const notified = await notifyContacters(gameState, activeContactUsers, chatId);
    if (notified) {
        await setTimerForContacters(chatId, gameState)
        gameState.thinkerTimer = setTimeout(async () => {
            await bot.sendMessage(chatId, "❌ Загадувач не написав слово!")
            gameState.revealedLetters = gameState.word.substring(0, gameState.revealedLetters.length + 1);
            await bot.sendMessage(chatId, `📝 Нова буква: *${gameState.revealedLetters}*`, {parse_mode: "Markdown"});
        }, 5000)
    }
    chatGameMap.set(chatId, gameState);
}

async function startGame(gameState, chatId) {
    if (!gameState) {
        chatGameMap.set(chatId, deepCopyDefaultState())
        gameState = chatGameMap.get(chatId);
    }
    if (gameState.active) return bot.sendMessage(chatId, "Гра вже йде!");
    clearGameState(chatId);
    gameState.active = true;
    chatGameMap.set(chatId, gameState);
    return bot.sendMessage(chatId, "🔮 Хто загадає слово? Натисніть /zahadaty");

}

async function newWord(gameState, chatId, userId) {
    if (!gameState.active) return bot.sendMessage(chatId, "Гра ще не почалась! Натисни /start_game");
    if (gameState.thinker) return bot.sendMessage(chatId, "Загадувач вже вибраний!");
    gameState.thinker = userId;
    chatGameMap.set(chatId, gameState);
    try {
        await bot.sendMessage(userId, "🤫 Введи слово, яке треба загадати. (Це повідомлення в особистому чаті)");
    } catch (error) {
        await bot.sendMessage(chatId, "🤫 ЗАЙДИ В БОТА И НАЖМИИ СТАРТБОТ, ТОГДА ЗАГАДЕШЬ");
    }
}

async function thinkerBeatContact(gameState, messageText, chatId, groupChatId) {
    return Promise.resolve(undefined);
}

bot.on('message', async message => {
        const isPrivate = (message.chat.type === "private");
        const userId = message.from.id
        const chatId = message.chat.id
        let gameState = chatGameMap.get(chatId);
        let messageText = message.text;
        //приватний чат
        if (isPrivate) {
            if (messageText === "/start_bot") {
                return await bot.sendMessage(chatId, "Тепер ти можеш брати участь в іграх")
            }
            if (!gameState || !gameState.active) return;
            const groupChatId = userChatMap.get(userId);
            const role = userRoleMap.get(userId);
            if (role === Role.THINKER) {
                if (gameState.thinkerTimer) return await thinkerBeatContact(gameState, messageText, chatId, groupChatId)
                return await thinkerMakesWord(gameState, messageText, userId, groupChatId)
            }
            if (role === Role.CONTACTOR) {
                return await contacterWritesWord(gameState, messageText, userId, groupChatId)
            }
            return
        }

        //чат публічний
        if (messageText === "/start_game") {
            return await startGame(gameState, chatId)
        }
        if (messageText === "/zahadaty") {
            return await newWord(gameState, chatId, userId)
        }
        const contactCommandRegExp = "^\\/contact(?:\\s+.+)?$"
        if (contactCommandRegExp.test(messageText)) {
            return await contact(gameState, message, chatId)
        }

    }
)


function clearContact(chatId, contacterIds) {
    let gameState = chatGameMap.get(chatId);
    clearTimeout(gameState.timer)
    gameState.timer = null;
    gameState.contactUsersMap.delete(gameState.activeContactId);
    gameState.activeContactId = null;
    gameState.contactWordMap.clear();
    chatGameMap.set(chatId, gameState);
    setRoles(contacterIds, Role.NONE)
}

function getChatIdByThinker(userId) {
    for (let [gameId, gameState] of chatGameMap) {
        if (gameState.thinker === userId) {
            return gameId;
        }
    }
    return null;
}

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
        clearContact(chatId);
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
