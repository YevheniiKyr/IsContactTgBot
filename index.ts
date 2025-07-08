import {ChatGameMap, GameState, JokeAndTranslatedJoke, Role, UserChatMap, UserRoleMap} from "./types";
import axios from 'axios';
const googleTTS = require('google-tts-api');
import fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import {Model, Recognizer} from 'vosk';
import TelegramBot, {ChatMember, Message} from "node-telegram-bot-api";

require('dotenv').config();

if(ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
const token: string | undefined = process.env.TELEGRAM_TOKEN;
const bot: TelegramBot = new TelegramBot(token, {polling: true});
const VOSK_MODEL_PATH = 'D:/vosk-model-small-uk-v3-small/vosk-model-small-uk-v3-small';
const model = new Model(VOSK_MODEL_PATH);

const defaultGameState: GameState = {
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
}

const chatGameMap: ChatGameMap = {}
const userChatMap: UserChatMap = {}
const userRoleMap: UserRoleMap = {}

const contactCommandRegExp = /^\/contact(?:\s+.*)?$/;

// commands
bot.setMyCommands([
    {command: '/start_bot', description: 'Почати гру'},
    {command: '/start_game', description: 'Почати гру'},
    {command: '/zahadaty', description: 'Загадати слово'},
    {command: '/rules', description: 'Правила'},
    {command: '/game', description: 'Игра угадай цифру'},
])


function clearGameState(chatId: number): void {
    chatGameMap[chatId] = deepCopyDefaultState();
}


function deepCopyDefaultState() {
    return structuredClone(defaultGameState);
}


function setRoles(userIds: number[], role: Role) {
    for (let userId in userIds)
        userRoleMap[userId] = role;
}


async function thinkerMakesWord(gameState: GameState, messageText: string, userId: number, groupChatId: number) {
    console.log("Thinker makes word")
    if (gameState.word !== "") return
    gameState.word = messageText.toLowerCase();
    gameState.firstLetter = gameState.word[0].toUpperCase();
    gameState.revealedLetters = gameState.firstLetter;
    chatGameMap[groupChatId] =  gameState;

    await bot.sendMessage(userId, "✅ Слово збережено! Повідом друзів, що гра почалась.");
    await bot.sendMessage(groupChatId, `ℹ️ Перша буква: *${gameState.firstLetter}*. Введи команду 
    /contact пояснення слова, щоб інші могли сконтактувати з тобою`, {parse_mode: "Markdown"});
}


async function contact(gameState: GameState, message: Message, chatId: number): Promise<void> {
    const userId: number = message.from?.id;
    if (!gameState || !gameState.active || !message.text) {
        await bot.sendMessage(chatId, "Гра ще не почалась! Натисни /start_game ");
        return
    }
    if (gameState.activeContactId != null) {
        await bot.sendMessage(chatId, "Люди вже контактують! Зачекай своєї черги)");
        return
    }
    if (userId === gameState.thinker) {
        await bot.sendMessage(chatId, "Загадувач не може брати участь у контакті");
        return
    }
    let activeContactUsers: number[] = await registerContact(gameState, userId, chatId, message);
    const notified: boolean = await notifyContactors(gameState, activeContactUsers, chatId);
    if (notified) {
        await setTimerForContactors(chatId, gameState)
        console.log("SET TIMER FOR THINKER")
        gameState.thinkerTimer = setTimeout(async (): Promise<void> => {
            await bot.sendMessage(chatId, "❌ Загадувач не написав слово!")
            gameState.revealedLetters = gameState.word.substring(0, gameState.revealedLetters.length + 1);
            await bot.sendMessage(chatId, `📝 Нова буква: *${gameState.revealedLetters}*`, {parse_mode: "Markdown"});
        }, 5000)
    }
    chatGameMap[chatId] =  gameState;
}


async function registerContact(gameState: GameState, userId: number, chatId: number, message: Message): Promise<number[]> {
    const repliedUserId: number = message.reply_to_message.from.id
    const repliedText: string = message.reply_to_message.text;
    if (!repliedUserId || !repliedText || !contactCommandRegExp.test(repliedText)) return
    gameState.activeContactId = gameState.lastContactId + 1;
    gameState.lastContactId++;
    gameState.activeContactorsIds = [repliedUserId, userId];
    await bot.sendMessage(chatId, `Є контакт`);
    userChatMap[userId] = chatId;
    return gameState.activeContactorsIds;
}


async function notifyContactors(gameState: GameState, activeContactUsers: number[], chatId: number): Promise<boolean> {
    let notified: boolean = true
    gameState.contactWordMap[activeContactUsers[0]] = null;
    gameState.contactWordMap[activeContactUsers[1]] = null;
    console.log("Active contacts", activeContactUsers[0], activeContactUsers[1])
    let contactorIds: number[] = Object.keys(gameState.contactWordMap).map(key => Number(key));
    let usernames: string[] = await getUsernamesByIDs(chatId, contactorIds);
    await bot.sendMessage(chatId, `${usernames[0]} i ${usernames[1]} - у вас контакт! Пишіть слово мені в особисті)`);
    try {
        await bot.sendMessage(contactorIds[0], `Я тут! Пиши слово`);
        await bot.sendMessage(contactorIds[1], `Я тут! Пиши слово`);
    } catch (e) {
        notified = false;
        await bot.sendMessage(chatId, `${usernames[0]} i ${usernames[0]} - ви обидва маєте ініціювати контакт з ботом, щоб грати!
        Контакт скасовано!`);
        clearContact(chatId);
    }
    return notified;
}


async function getUsernamesByIDs(chatId: number, ids: number[]): Promise<string[]> {
    let usernames: string[] = []
    for (const userId of ids){
        const chatMember: ChatMember = await bot.getChatMember(chatId, userId)
        usernames.push(chatMember.user.first_name + ' ' + chatMember.user.last_name)
    }
    return usernames;
}

async function contactorWritesWord(gameState: GameState, messageText: string, userId: number, groupChatId: number) {
    console.log("CONTACTOR WRITES WORD ")
    if (!gameState.contactWordMap[userId]) return;
    if (gameState.contactWordMap[userId] !== null) return
    gameState.contactWordMap[userId] = messageText.toLowerCase();
    await bot.sendMessage(userId, "✅ Слово зафіксовано! Тепер побачимо чи у вас стався збіг ...");
    gameState.amountOfReadyContactors += 1;
    if (gameState.amountOfReadyContactors === 2) {
        console.log("input words", Object.values(gameState.contactWordMap))

        const isCorrect: boolean = isContactCorrect(Object.values(gameState.contactWordMap), gameState.revealedLetters)
        if (isCorrect) {
            await bot.sendMessage(groupChatId, `✅ Контакт правильний! Загадувач має 4 секунди, щоб перебити контакт!`, {parse_mode: "Markdown"});

            gameState.thinkerTimer = setTimeout(async () => {
                gameState.revealedLetters = gameState.word.substring(0, gameState.revealedLetters.length + 1);
                await bot.sendMessage(groupChatId, `⌛ Загадувач попуск....`, {parse_mode: "Markdown"});
                await bot.sendMessage(groupChatId, `📝 Нова буква: *${gameState.revealedLetters}*`, {parse_mode: "Markdown"});
            }, 4000)
        }
        if (gameState.revealedLetters.length === gameState.word.length) {
            await bot.sendMessage(groupChatId, "🎉 Вітаємо! Слово відгадане! Гра завершена.");
            clearGameState(groupChatId);
        }
        if (!isCorrect) {
            await bot.sendMessage(groupChatId, "На жаль користувачі ввели різні слова(. Нова буква не буде відкрита");
        }
        clearContact(groupChatId);

        setRoles(Object.keys(gameState.contactWordMap).map(key=>Number(key)), Role.None)
        setRoles([gameState.thinker], Role.None)
    }
}

async function setTimerForContactors(chatId: number, gameState: GameState) {
    await bot.sendMessage(chatId, "🕐 Відлік: 5... 4... 3... 2... 1...");
    gameState.contactorsTimer = setTimeout(async () => {
        await bot.sendMessage(chatId, "⌛ Час вийшов... Не всі контакти написали слово ..");
        clearContact(chatId)
    }, 5000);
}


async function startGame(gameState: GameState, chatId: number) {
    console.log("Start game")
    if (!gameState) {
        chatGameMap[chatId] = deepCopyDefaultState()
        gameState = chatGameMap[chatId];
    }
    if (gameState.active) {
        await bot.sendMessage(chatId, "Гра вже йде!");
        return;
    }
    clearGameState(chatId);
    gameState.active = true;
    chatGameMap[chatId] = gameState
    await bot.sendMessage(chatId, "🔮 Хто загадає слово? Натисніть /zahadaty");
    return
}


async function newWord(gameState: GameState, chatId: number, userId: number) {
    console.log("new word")
    if (!gameState || !gameState.active) return bot.sendMessage(chatId, "Гра ще не почалась! Натисни /start_game");
    if (gameState.thinker) return bot.sendMessage(chatId, "Загадувач вже вибраний!");
    gameState.thinker = userId;
    userRoleMap[userId] = Role.Thinker;
    try {
        await bot.sendMessage(userId, "🤫 Введи слово, яке треба загадати. (Це повідомлення в особистому чаті)");
    } catch (error) {
        await bot.sendMessage(chatId, "🤫 Зайди в бота, і натисни start, тоді зможеш брати участь в іграх");
        gameState.thinker = null;
    }
}


async function thinkerBeatContact(gameState: GameState, messageText: string, groupChatId: number) {
    const contactWords: string[] = Object.values(gameState.contactWordMap);
    if (gameState.thinkerTimer !== null && (messageText.trim() === contactWords[0].trim())) {
        clearContact(groupChatId);
        await bot.sendMessage(groupChatId, "❌ Загадувач перебив відгадування! Нова буква не буде додана.");
    }
    chatGameMap[groupChatId] = gameState;
}

function clearContact(chatId: number): void {
    let gameState: GameState = chatGameMap[chatId]
    const contactorIds: number[] = gameState.activeContactorsIds
    if(gameState.contactorsTimer) clearTimeout(gameState.contactorsTimer)
    if(gameState.thinkerTimer) clearTimeout(gameState.thinkerTimer)
    gameState.contactorsTimer = null;
    gameState.thinkerTimer = null;
    gameState.activeContactId = null;
    gameState.contactWordMap = {}
    setRoles(contactorIds, Role.None)
}

function getChatIdByThinker(userId: number): number | null {
    const keys: string[] = Object.keys(chatGameMap)
    for (const key of keys) {
        const numberKey: number = Number(key)
        const gameState: GameState = chatGameMap[numberKey];
        if (gameState.thinker === userId) {
            return Number(key);
        }
    }
    return null;
}


function isContactCorrect(contactWords: string[], revealedLetters: string): boolean {
    if (contactWords[0] !== contactWords[1]) return false;
    return contactWords[0].startsWith(revealedLetters.toLowerCase());
}

bot.on('message', async message => {
        const isPrivate: boolean = (message.chat.type === "private");
        const userId: number = message.from.id
        const chatId: number = message.chat.id
        //if public chat
        let gameState: GameState = chatGameMap[chatId];
        let messageText: string = message.text;
        if (!messageText) return

        //жарт
        if (messageText.toLowerCase() === "хочу жарт") {
            const {joke, translatedJoke} = await getJoke()
            if (joke) {
                await bot.sendMessage(chatId, joke);
            }
            if (translatedJoke) {
                await bot.sendMessage(chatId, translatedJoke);
                await sendVoice(translatedJoke, 1.3, chatId);
            }
            return
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
                const jokeStart = `${repliedUser.first_name}, я відповім тобі на це моїм улюбленим анекдотом.`
                await sendVoice(jokeStart, 1.5, chatId);
                await sendVoice(platonJokeChunk1, 1.7, chatId);
                return await sendVoice(platonJokeChunk2, 1.7, chatId);
            }
        }

        //приватний чат
        if (isPrivate) {
            if (messageText === "/start_bot") {
                return await bot.sendMessage(chatId, "Тепер ти можеш брати участь в іграх")
            }
            const groupChatId: number = userChatMap[userId];
            const role: Role = userRoleMap[userId];
            let gameState: GameState = chatGameMap[groupChatId];
            if (role === Role.Thinker) {
                console.log("Thinker role")
                if (gameState.thinkerTimer) return await thinkerBeatContact(gameState, messageText, groupChatId)
                return await thinkerMakesWord(gameState, messageText, userId, groupChatId)
            }
            if (role === Role.Contactor) {
                console.log("Contactor role")
                return await contactorWritesWord(gameState, messageText, userId, groupChatId)
            }
            return
        } else {
            console.log("chat is public")
            //чат публічний
            if (!userChatMap[userId]) {
                userChatMap[userId] = chatId
            }
            if (messageText.startsWith("/start_game")) {
                return await startGame(gameState, chatId)
            }
            console.log(gameState?.active)
            console.log(gameState)
            console.log(messageText)
            if (!gameState || !gameState.active || !messageText) return;
            if (messageText.startsWith("/zahadaty")) {
                return await newWord(gameState, chatId, userId)
            }
            if (contactCommandRegExp.test(messageText)) {
                return await contact(gameState, message, chatId)
            }
            //додати умову що це має бути не thinker
            if (messageText === gameState.word) {
                await bot.sendMessage(chatId, "🎉 Вітаємо! Слово відгадане! Гра завершена.");
                clearGameState(chatId);
                setRoles(Object.keys(gameState.contactWordMap).map(key => Number(key)), Role.None)
                setRoles([gameState.thinker], Role.None)
            }
        }
    }
)

async function getJoke(): Promise<JokeAndTranslatedJoke> {
    try {
        const response = await axios.get(process.env.JOKE_API_URL, {
            headers: {'X-Api-Key': process.env.JOKE_API_KEY}
        });
        const joke: string = response.data[0].joke
        const translatedJoke: string = await translateText(joke)
        return {joke, translatedJoke};
    } catch (error) {
        console.error('Помилка отримання жарту:', error.response ? error.response.data : error.message);
    }
}

async function translateText(text: string) {
    try {
        const response = await axios.get("https://api.mymemory.translated.net/get", {
            params: {
                q: text,
                langpair: "en|uk"
            }
        });
        return response.data.responseData.translatedText;
    } catch (error) {
        console.error("Помилка перекладу:", error);
        return text;
    }
}

async function sendVoice(text: string, speedUp: number, chatId: number) {
    try {
        const url: string = googleTTS.getAudioUrl(text, {
            lang: "uk",
            slow: false,
            host: "https://translate.google.com",
        });
        console.log(url)
        const response = await axios.get(url, {responseType: "arraybuffer"});
        const mp3Path = "joke.mp3";
        fs.writeFileSync(mp3Path, response.data);
        const fastMp3Path = "joke_fast.mp3";
        // Прискорюємо аудіо на 30%
        await new Promise((resolve, reject) => {
            ffmpeg(mp3Path)
                .audioFilter(`atempo=${speedUp}`) // 1.3 = +30% швидкості
                .on("end", resolve)
                .on("error", reject)
                .save(fastMp3Path);
        });
        // Відправляємо оброблене аудіо
        await bot.sendVoice(chatId, fastMp3Path);
        // Видаляємо тимчасові файли
        fs.unlinkSync(mp3Path);
        fs.unlinkSync(fastMp3Path);
        console.log("Відправлено голосове повідомлення!");
    } catch (error) {
        console.error("Помилка створення аудіо:", error);
    }
}

//переклад войсу в текст
// bot.on('voice', async (msg) => {
//     const chatId: number = msg.chat.id;
//     const fileId: string = msg.voice.file_id;
//     try {
//         // Отримуємо посилання на файл
//         const fileLink: string = await bot.getFileLink(fileId);
//         const oggPath = 'voice.ogg';
//         const wavPath = 'voice.wav';
//         // Завантажуємо голосове повідомлення
//         const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
//         fs.writeFileSync(oggPath, response.data);
//         // Конвертуємо .ogg у .wav (16kHz, моно)
//         await new Promise((resolve, reject) => {
//             ffmpeg(oggPath)
//                 .toFormat('wav')
//                 .audioFrequency(16000)
//                 .audioChannels(1)
//                 .on('end', resolve)
//                 .on('error', reject)
//                 .save(wavPath);
//         });
//         // Виконуємо розпізнавання мови через Vosk
//         const rec = new Recognizer({ model: model, sampleRate: 16000 });
//         const audioData: Buffer = fs.readFileSync(wavPath);
//         rec.acceptWaveform(audioData);
//         const result: string = rec.result().text
//         let text: string = ''
//         if(result) text = result
//             else text = 'Не вдалося розпізнати голос.'
//         // Відповідаємо користувачу його текстом
//         await bot.sendMessage(chatId, text, {reply_to_message_id: msg.message_id});
//         // Видаляємо тимчасові файли
//         fs.unlinkSync(oggPath);
//         fs.unlinkSync(wavPath);
//     } catch (error) {
//         console.error(error);
//         await bot.sendMessage(chatId, 'Помилка розпізнавання голосу.');
//     }
// });



