// scripts/diagnose.ts
import fs from "fs";
import path from "path";

const filePath = path.join(__dirname, "../data/valeursfoncieres-2025.txt");
const content = fs.readFileSync(filePath, "utf-8");
const lines = content.split("\n");

console.log("=== PREMIÈRE LIGNE (Headers) ===");
console.log(lines[0]);
console.log("");
console.log("=== DEUXIÈME LIGNE (Exemple de données) ===");
console.log(lines[1]);
console.log("");
console.log("=== SÉPARATEUR DÉTECTÉ ===");
const firstLine = lines[0];
if (firstLine.includes("\t")) console.log("Tabulation (\\t)");
else if (firstLine.includes(";")) console.log("Point-virgule (;)");
else if (firstLine.includes(",")) console.log("Virgule (,)");
else if (firstLine.includes("|")) console.log("Pipe (|)");
else console.log("Séparateur inconnu");
