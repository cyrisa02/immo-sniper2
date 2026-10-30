import Groq from "groq-sdk";
import dotenv from "dotenv";
dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function listModels() {
  const models = await groq.models.list();
  console.log(`Total: ${models.data.length} modèles disponibles\n`);

  // Trier par nom
  const sorted = models.data.sort((a, b) => a.id.localeCompare(b.id));

  // Afficher tous les modèles
  console.log("=== TOUS LES MODÈLES ===");
  sorted.forEach((m) => console.log(`  - ${m.id}`));

  // Chercher les modèles vision (capables de traiter des images)
  console.log("\n=== MODÈLES VISION (suspects) ===");
  const visionKeywords = [
    "vision",
    "llava",
    "qwen-vl",
    "qwen2-vl",
    "internvl",
    "minicpm",
    "mllama",
    "llama-3.2",
    "llama4",
  ];
  sorted.forEach((m) => {
    const id = m.id.toLowerCase();
    if (visionKeywords.some((k) => id.includes(k))) {
      console.log(`  ✅ ${m.id}`);
    }
  });
}

listModels();
