const regex = /^\/contact(?:\s+.*)?$/;



const text = "/contact wdwd ecec";
console.log("Тестовий рядок:", text); // Дивимося, що реально міститься

if (regex.test(text)) {
    console.log("✅ Збіг знайдено!");
} else {
    console.log("❌ Нема збігу!");
}


const defaultGameState = {
    active: false,
    word: "",
    firstLetter: "",
    revealedLetters: "",
    thinker: null,
    contactWordMap: new Map(),
    timer: null,
    currentContactId: 1,
    activeContactId: null,
    //contact id, users array
    contactUsersMap: new Map(),
};
let chatGameMap = new Map();
//
// chatGameMap.set(1,  JSON.parse(JSON.stringify(defaultGameState)));
// chatGameMap.get(1).revealedLetters = "REVEALED"
// console.log(`revealed `,defaultGameState.revealedLetters);