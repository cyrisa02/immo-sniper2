// scripts/find-chat-id.ts
import dotenv from "dotenv";
dotenv.config();

async function findChatId() {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  console.log("🔍 Récupération des mises à jour du bot...");
  console.log(
    "⚠️  Envoie d'abord /start à @immo_sniper_alicia_bot dans Telegram\n",
  );

  const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
  const data = await res.json();

  if (data.ok && data.result.length > 0) {
    console.log("✅ Conversations trouvées :\n");
    data.result.forEach((update: any) => {
      if (update.message?.chat) {
        const chat = update.message.chat;
        console.log(`   Chat ID: ${chat.id}`);
        console.log(`   Nom: ${chat.first_name} ${chat.last_name || ""}`);
        console.log(`   Username: @${chat.username || "N/A"}`);
        console.log(`   Type: ${chat.type}`);
        console.log(`   Dernier message: "${update.message.text}"\n`);
      }
    });
  } else {
    console.log("❌ Aucune conversation trouvée");
    console.log("\n💡 Le bot n'a reçu aucun message.");
    console.log("   Ouvre Telegram, cherche @immo_sniper_alicia_bot");
    console.log("   Envoie /start dans la conversation");
    console.log("   Puis relance ce script");
  }
}

findChatId();
