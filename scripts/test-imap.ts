// scripts/test-imap.ts
import Imap from "imap";
import dotenv from "dotenv";

dotenv.config();

console.log("🔧 Test de connexion IMAP...");
console.log(`   Host: ${process.env.IMAP_HOST}`);
console.log(`   Port: ${process.env.IMAP_PORT}`);
console.log(`   User: ${process.env.IMAP_USER}`);
console.log(`   TLS: ${process.env.IMAP_TLS}`);
console.log(
  `   Password length: ${process.env.IMAP_PASSWORD?.length || 0} chars`,
);

const imap = new Imap({
  user: process.env.IMAP_USER,
  password: process.env.IMAP_PASSWORD,
  host: process.env.IMAP_HOST,
  port: parseInt(process.env.IMAP_PORT || "993"),
  tls: process.env.IMAP_TLS === "true",
  tlsOptions: { rejectUnauthorized: false },
  connTimeout: 10000,
  authTimeout: 10000,
});

imap.once("ready", () => {
  console.log("✅ Connexion IMAP réussie !");
  imap.end();
});

imap.once("error", (err: any) => {
  console.error(" Erreur:", err.message);
  if (err.source === "timeout-auth") {
    console.log("\n💡 Causes possibles :");
    console.log("   1. Mot de passe d'application incorrect");
    console.log("   2. Espaces dans le mot de passe");
    console.log("   3. Compte Gmail sans authentification 2FA activée");
    console.log(
      "\n🔗 Crée un mot de passe d'application : https://myaccount.google.com/apppasswords",
    );
  }
});

imap.connect();
