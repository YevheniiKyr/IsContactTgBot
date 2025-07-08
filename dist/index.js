"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const types_1 = require("./types");
const axios_1 = __importDefault(require("axios"));
const googleTTS = require('google-tts-api');
const fs_1 = __importDefault(require("fs"));
const fluent_ffmpeg_1 = __importDefault(require("fluent-ffmpeg"));
const ffmpeg_static_1 = __importDefault(require("ffmpeg-static"));
const vosk_1 = require("vosk");
const node_telegram_bot_api_1 = __importDefault(require("node-telegram-bot-api"));
require('dotenv').config();
if (ffmpeg_static_1.default)
    fluent_ffmpeg_1.default.setFfmpegPath(ffmpeg_static_1.default);
const token = process.env.TELEGRAM_TOKEN;
const bot = new node_telegram_bot_api_1.default(token, { polling: true });
const VOSK_MODEL_PATH = 'D:/vosk-model-small-uk-v3-small/vosk-model-small-uk-v3-small';
const model = new vosk_1.Model(VOSK_MODEL_PATH);
const defaultGameState = {
    active: false,
    word: "",
    firstLetter: "",
    revealedLetters: "",
    thinker: null,
    contactWordMap: {},
    contactorsTimer: null,
    activeContactId: null,
    thinkerTimer: null,
    amountOfReadyContactors: 0,
    activeContactorsIds: [],
    lastContactId: 0
};
const chatGameMap = {};
const userChatMap = {};
const userRoleMap = {};
const contactCommandRegExp = /^\/contact(?:\s+.*)?$/;
// commands
bot.setMyCommands([
    { command: '/start_bot', description: 'Почати гру' },
    { command: '/start_game', description: 'Почати гру' },
    { command: '/zahadaty', description: 'Загадати слово' },
    { command: '/rules', description: 'Правила' },
    { command: '/game', description: 'Игра угадай цифру' },
]);
function clearGameState(chatId) {
    chatGameMap[chatId] = deepCopyDefaultState();
}
function deepCopyDefaultState() {
    return structuredClone(defaultGameState);
}
function setRoles(userIds, role) {
    for (let userId in userIds)
        userRoleMap[userId] = role;
}
function thinkerMakesWord(gameState, messageText, userId, groupChatId) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("Thinker makes word");
        if (gameState.word !== "")
            return;
        gameState.word = messageText.toLowerCase();
        gameState.firstLetter = gameState.word[0].toUpperCase();
        gameState.revealedLetters = gameState.firstLetter;
        chatGameMap[groupChatId] = gameState;
        yield bot.sendMessage(userId, "✅ Слово збережено! Повідом друзів, що гра почалась.");
        yield bot.sendMessage(groupChatId, `ℹ️ Перша буква: *${gameState.firstLetter}*. Введи команду 
    /contact пояснення слова, щоб інші могли сконтактувати з тобою`, { parse_mode: "Markdown" });
    });
}
function contact(gameState, message, chatId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const userId = (_a = message.from) === null || _a === void 0 ? void 0 : _a.id;
        if (!gameState || !gameState.active || !message.text) {
            yield bot.sendMessage(chatId, "Гра ще не почалась! Натисни /start_game ");
            return;
        }
        if (gameState.activeContactId != null) {
            yield bot.sendMessage(chatId, "Люди вже контактують! Зачекай своєї черги)");
            return;
        }
        if (userId === gameState.thinker) {
            yield bot.sendMessage(chatId, "Загадувач не може брати участь у контакті");
            return;
        }
        let activeContactUsers = yield registerContact(gameState, userId, chatId, message);
        const notified = yield notifyContactors(gameState, activeContactUsers, chatId);
        if (notified) {
            yield setTimerForContactors(chatId, gameState);
            console.log("SET TIMER FOR THINKER");
            gameState.thinkerTimer = setTimeout(() => __awaiter(this, void 0, void 0, function* () {
                yield bot.sendMessage(chatId, "❌ Загадувач не написав слово!");
                gameState.revealedLetters = gameState.word.substring(0, gameState.revealedLetters.length + 1);
                yield bot.sendMessage(chatId, `📝 Нова буква: *${gameState.revealedLetters}*`, { parse_mode: "Markdown" });
            }), 5000);
        }
        chatGameMap[chatId] = gameState;
    });
}
function registerContact(gameState, userId, chatId, message) {
    return __awaiter(this, void 0, void 0, function* () {
        const repliedUserId = message.reply_to_message.from.id;
        const repliedText = message.reply_to_message.text;
        if (!repliedUserId || !repliedText || !contactCommandRegExp.test(repliedText))
            return;
        gameState.activeContactId = gameState.lastContactId + 1;
        gameState.lastContactId++;
        gameState.activeContactorsIds = [repliedUserId, userId];
        yield bot.sendMessage(chatId, `Є контакт`);
        userChatMap[userId] = chatId;
        return gameState.activeContactorsIds;
    });
}
function notifyContactors(gameState, activeContactUsers, chatId) {
    return __awaiter(this, void 0, void 0, function* () {
        let notified = true;
        gameState.contactWordMap[activeContactUsers[0]] = null;
        gameState.contactWordMap[activeContactUsers[1]] = null;
        console.log("Active contacts", activeContactUsers[0], activeContactUsers[1]);
        let contactorIds = Object.keys(gameState.contactWordMap).map(key => Number(key));
        let usernames = yield getUsernamesByIDs(chatId, contactorIds);
        yield bot.sendMessage(chatId, `${usernames[0]} i ${usernames[1]} - у вас контакт! Пишіть слово мені в особисті)`);
        try {
            yield bot.sendMessage(contactorIds[0], `Я тут! Пиши слово`);
            yield bot.sendMessage(contactorIds[1], `Я тут! Пиши слово`);
        }
        catch (e) {
            notified = false;
            yield bot.sendMessage(chatId, `${usernames[0]} i ${usernames[0]} - ви обидва маєте ініціювати контакт з ботом, щоб грати!
        Контакт скасовано!`);
            clearContact(chatId);
        }
        return notified;
    });
}
function getUsernamesByIDs(chatId, ids) {
    return __awaiter(this, void 0, void 0, function* () {
        let usernames = [];
        for (const userId of ids) {
            const chatMember = yield bot.getChatMember(chatId, userId);
            usernames.push(chatMember.user.first_name + ' ' + chatMember.user.last_name);
        }
        return usernames;
    });
}
function contactorWritesWord(gameState, messageText, userId, groupChatId) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("CONTACTOR WRITES WORD ");
        if (!gameState.contactWordMap[userId])
            return;
        if (gameState.contactWordMap[userId] !== null)
            return;
        gameState.contactWordMap[userId] = messageText.toLowerCase();
        yield bot.sendMessage(userId, "✅ Слово зафіксовано! Тепер побачимо чи у вас стався збіг ...");
        gameState.amountOfReadyContactors += 1;
        if (gameState.amountOfReadyContactors === 2) {
            console.log("input words", Object.values(gameState.contactWordMap));
            const isCorrect = isContactCorrect(Object.values(gameState.contactWordMap), gameState.revealedLetters);
            if (isCorrect) {
                yield bot.sendMessage(groupChatId, `✅ Контакт правильний! Загадувач має 4 секунди, щоб перебити контакт!`, { parse_mode: "Markdown" });
                gameState.thinkerTimer = setTimeout(() => __awaiter(this, void 0, void 0, function* () {
                    gameState.revealedLetters = gameState.word.substring(0, gameState.revealedLetters.length + 1);
                    yield bot.sendMessage(groupChatId, `⌛ Загадувач попуск....`, { parse_mode: "Markdown" });
                    yield bot.sendMessage(groupChatId, `📝 Нова буква: *${gameState.revealedLetters}*`, { parse_mode: "Markdown" });
                }), 4000);
            }
            if (gameState.revealedLetters.length === gameState.word.length) {
                yield bot.sendMessage(groupChatId, "🎉 Вітаємо! Слово відгадане! Гра завершена.");
                clearGameState(groupChatId);
            }
            if (!isCorrect) {
                yield bot.sendMessage(groupChatId, "На жаль користувачі ввели різні слова(. Нова буква не буде відкрита");
            }
            clearContact(groupChatId);
            setRoles(Object.keys(gameState.contactWordMap).map(key => Number(key)), types_1.Role.None);
            setRoles([gameState.thinker], types_1.Role.None);
        }
    });
}
function setTimerForContactors(chatId, gameState) {
    return __awaiter(this, void 0, void 0, function* () {
        yield bot.sendMessage(chatId, "🕐 Відлік: 5... 4... 3... 2... 1...");
        gameState.contactorsTimer = setTimeout(() => __awaiter(this, void 0, void 0, function* () {
            yield bot.sendMessage(chatId, "⌛ Час вийшов... Не всі контакти написали слово ..");
            clearContact(chatId);
        }), 5000);
    });
}
function startGame(gameState, chatId) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("Start game");
        if (!gameState) {
            chatGameMap[chatId] = deepCopyDefaultState();
            gameState = chatGameMap[chatId];
        }
        if (gameState.active) {
            yield bot.sendMessage(chatId, "Гра вже йде!");
            return;
        }
        clearGameState(chatId);
        gameState.active = true;
        chatGameMap[chatId] = gameState;
        yield bot.sendMessage(chatId, "🔮 Хто загадає слово? Натисніть /zahadaty");
        return;
    });
}
function newWord(gameState, chatId, userId) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("new word");
        if (!gameState || !gameState.active)
            return bot.sendMessage(chatId, "Гра ще не почалась! Натисни /start_game");
        if (gameState.thinker)
            return bot.sendMessage(chatId, "Загадувач вже вибраний!");
        gameState.thinker = userId;
        userRoleMap[userId] = types_1.Role.Thinker;
        try {
            yield bot.sendMessage(userId, "🤫 Введи слово, яке треба загадати. (Це повідомлення в особистому чаті)");
        }
        catch (error) {
            yield bot.sendMessage(chatId, "🤫 Зайди в бота, і натисни start, тоді зможеш брати участь в іграх");
            gameState.thinker = null;
        }
    });
}
function thinkerBeatContact(gameState, messageText, groupChatId) {
    return __awaiter(this, void 0, void 0, function* () {
        const contactWords = Object.values(gameState.contactWordMap);
        if (gameState.thinkerTimer !== null && (messageText.trim() === contactWords[0].trim())) {
            clearContact(groupChatId);
            yield bot.sendMessage(groupChatId, "❌ Загадувач перебив відгадування! Нова буква не буде додана.");
        }
        chatGameMap[groupChatId] = gameState;
    });
}
function clearContact(chatId) {
    let gameState = chatGameMap[chatId];
    const contactorIds = gameState.activeContactorsIds;
    if (gameState.contactorsTimer)
        clearTimeout(gameState.contactorsTimer);
    if (gameState.thinkerTimer)
        clearTimeout(gameState.thinkerTimer);
    gameState.contactorsTimer = null;
    gameState.thinkerTimer = null;
    gameState.activeContactId = null;
    gameState.contactWordMap = {};
    setRoles(contactorIds, types_1.Role.None);
}
function getChatIdByThinker(userId) {
    const keys = Object.keys(chatGameMap);
    for (const key of keys) {
        const numberKey = Number(key);
        const gameState = chatGameMap[numberKey];
        if (gameState.thinker === userId) {
            return Number(key);
        }
    }
    return null;
}
function isContactCorrect(contactWords, revealedLetters) {
    if (contactWords[0] !== contactWords[1])
        return false;
    return contactWords[0].startsWith(revealedLetters.toLowerCase());
}
bot.on('message', (message) => __awaiter(void 0, void 0, void 0, function* () {
    const isPrivate = (message.chat.type === "private");
    const userId = message.from.id;
    const chatId = message.chat.id;
    //if public chat
    let gameState = chatGameMap[chatId];
    let messageText = message.text;
    if (!messageText)
        return;
    //жарт
    if (messageText.toLowerCase() === "хочу жарт") {
        const { joke, translatedJoke } = yield getJoke();
        if (joke) {
            yield bot.sendMessage(chatId, joke);
        }
        if (translatedJoke) {
            yield bot.sendMessage(chatId, translatedJoke);
            yield sendVoice(translatedJoke, 1.3, chatId);
        }
        return;
    }
    //жарт про Платона
    if (messageText.toLowerCase() === "ти часом не душніла?") {
        const platonJokeChunk1 = "" +
            "Якось Платон сказав: \"Людина — це тварина на двох ногах, позбавлена пір'я.\"\n" +
            "Це почув Діоген, обскуб півня і показав Платону:\n" +
            "— Ось тобі платонівська людина!\n";
        const platonJokeChunk2 = "Платон відповів:\n" +
            "— Бля, ну ти й душніла йобаний!!!\n" +
            "І розніс Діогену хату. 😆";
        if (message.reply_to_message) {
            const repliedUser = message.reply_to_message.from;
            const jokeStart = `${repliedUser.first_name}, я відповім тобі на це моїм улюбленим анекдотом.`;
            yield sendVoice(jokeStart, 1.5, chatId);
            yield sendVoice(platonJokeChunk1, 1.7, chatId);
            return yield sendVoice(platonJokeChunk2, 1.7, chatId);
        }
    }
    //приватний чат
    if (isPrivate) {
        if (messageText === "/start_bot") {
            return yield bot.sendMessage(chatId, "Тепер ти можеш брати участь в іграх");
        }
        const groupChatId = userChatMap[userId];
        const role = userRoleMap[userId];
        let gameState = chatGameMap[groupChatId];
        if (role === types_1.Role.Thinker) {
            console.log("Thinker role");
            if (gameState.thinkerTimer)
                return yield thinkerBeatContact(gameState, messageText, groupChatId);
            return yield thinkerMakesWord(gameState, messageText, userId, groupChatId);
        }
        if (role === types_1.Role.Contactor) {
            console.log("Contactor role");
            return yield contactorWritesWord(gameState, messageText, userId, groupChatId);
        }
        return;
    }
    else {
        console.log("chat is public");
        //чат публічний
        if (!userChatMap[userId]) {
            userChatMap[userId] = chatId;
        }
        if (messageText.startsWith("/start_game")) {
            return yield startGame(gameState, chatId);
        }
        console.log(gameState === null || gameState === void 0 ? void 0 : gameState.active);
        console.log(gameState);
        console.log(messageText);
        if (!gameState || !gameState.active || !messageText)
            return;
        if (messageText.startsWith("/zahadaty")) {
            return yield newWord(gameState, chatId, userId);
        }
        if (contactCommandRegExp.test(messageText)) {
            return yield contact(gameState, message, chatId);
        }
        //додати умову що це має бути не thinker
        if (messageText === gameState.word) {
            yield bot.sendMessage(chatId, "🎉 Вітаємо! Слово відгадане! Гра завершена.");
            clearGameState(chatId);
            setRoles(Object.keys(gameState.contactWordMap).map(key => Number(key)), types_1.Role.None);
            setRoles([gameState.thinker], types_1.Role.None);
        }
    }
}));
function getJoke() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const response = yield axios_1.default.get(process.env.JOKE_API_URL, {
                headers: { 'X-Api-Key': process.env.JOKE_API_KEY }
            });
            const joke = response.data[0].joke;
            const translatedJoke = yield translateText(joke);
            return { joke, translatedJoke };
        }
        catch (error) {
            console.error('Помилка отримання жарту:', error.response ? error.response.data : error.message);
        }
    });
}
function translateText(text) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const response = yield axios_1.default.get("https://api.mymemory.translated.net/get", {
                params: {
                    q: text,
                    langpair: "en|uk"
                }
            });
            return response.data.responseData.translatedText;
        }
        catch (error) {
            console.error("Помилка перекладу:", error);
            return text;
        }
    });
}
function sendVoice(text, speedUp, chatId) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const url = googleTTS.getAudioUrl(text, {
                lang: "uk",
                slow: false,
                host: "https://translate.google.com",
            });
            console.log(url);
            const response = yield axios_1.default.get(url, { responseType: "arraybuffer" });
            const mp3Path = "joke.mp3";
            fs_1.default.writeFileSync(mp3Path, response.data);
            const fastMp3Path = "joke_fast.mp3";
            // Прискорюємо аудіо на 30%
            yield new Promise((resolve, reject) => {
                (0, fluent_ffmpeg_1.default)(mp3Path)
                    .audioFilter(`atempo=${speedUp}`) // 1.3 = +30% швидкості
                    .on("end", resolve)
                    .on("error", reject)
                    .save(fastMp3Path);
            });
            // Відправляємо оброблене аудіо
            yield bot.sendVoice(chatId, fastMp3Path);
            // Видаляємо тимчасові файли
            fs_1.default.unlinkSync(mp3Path);
            fs_1.default.unlinkSync(fastMp3Path);
            console.log("Відправлено голосове повідомлення!");
        }
        catch (error) {
            console.error("Помилка створення аудіо:", error);
        }
    });
}
//переклад войсу в текст
bot.on('voice', (msg) => __awaiter(void 0, void 0, void 0, function* () {
    const chatId = msg.chat.id;
    const fileId = msg.voice.file_id;
    try {
        // Отримуємо посилання на файл
        const fileLink = yield bot.getFileLink(fileId);
        const oggPath = 'voice.ogg';
        const wavPath = 'voice.wav';
        // Завантажуємо голосове повідомлення
        const response = yield axios_1.default.get(fileLink, { responseType: 'arraybuffer' });
        fs_1.default.writeFileSync(oggPath, response.data);
        // Конвертуємо .ogg у .wav (16kHz, моно)
        yield new Promise((resolve, reject) => {
            (0, fluent_ffmpeg_1.default)(oggPath)
                .toFormat('wav')
                .audioFrequency(16000)
                .audioChannels(1)
                .on('end', resolve)
                .on('error', reject)
                .save(wavPath);
        });
        // Виконуємо розпізнавання мови через Vosk
        const rec = new vosk_1.Recognizer({ model: model, sampleRate: 16000 });
        const audioData = fs_1.default.readFileSync(wavPath);
        rec.acceptWaveform(audioData);
        const result = rec.result().text;
        let text = '';
        if (result)
            text = result;
        else
            text = 'Не вдалося розпізнати голос.';
        // Відповідаємо користувачу його текстом
        yield bot.sendMessage(chatId, text, { reply_to_message_id: msg.message_id });
        // Видаляємо тимчасові файли
        fs_1.default.unlinkSync(oggPath);
        fs_1.default.unlinkSync(wavPath);
    }
    catch (error) {
        console.error(error);
        yield bot.sendMessage(chatId, 'Помилка розпізнавання голосу.');
    }
}));
