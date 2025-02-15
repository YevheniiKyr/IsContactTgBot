const regex = /^\/contact(?:\s+.+)?$/;


const text = "/contact";
console.log("Тестовий рядок:", text); // Дивимося, що реально міститься

if (regex.test(text)) {
    console.log("✅ Збіг знайдено!");
} else {
    console.log("❌ Нема збігу!");
}
