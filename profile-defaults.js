// profile-defaults.js - Neutral defaults. No personal data lives in this extension's source:
// the user's profile is created from their own resume and stored in chrome.storage.local.
const DEFAULT_AI_CONFIG = {
  groqKey: "",
  groqKeys: [],
  openrouterKeys: [],
  geminiKeys: [""],
  geminiModel: "auto",
  preferredProvider: "gemini"
};
