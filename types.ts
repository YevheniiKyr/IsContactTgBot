export enum  Role {
    Thinker = "thinker",
    Contactor = "contactor",
    None =  "none"
}

export type GameState = {
    active: boolean,
    word: string,
    firstLetter: string,
    revealedLetters: string,
    thinker: number | null,
    contactWordMap: ContactWordMap,
    contactorsTimer: null | NodeJS.Timeout,
    activeContactId: number | null,
    thinkerTimer: null | NodeJS.Timeout,
    amountOfReadyContactors: number,
    activeContactorsIds: number[],
    lastContactId: number,
}

type ContactWordMap = {
    [key: number]: string
}

export type ChatGameMap = {
    [key: number]: GameState
}

export type UserChatMap = {
    [key: number]: number
}

export type UserRoleMap = {
    [key: number]: Role
}

export type JokeAndTranslatedJoke = {
    joke: string,
    translatedJoke: string,
}



