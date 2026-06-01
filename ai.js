// ─────────────────────────────────────────────────────────────────────────────
//  ai.js — Braksoo IA — HorizonPvP — Powered by Google Gemini (GRATUIT)
// ─────────────────────────────────────────────────────────────────────────────

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL     = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=';

// Historique des conversations par channel/user
const conversationHistory = new Map();

// ─── SYSTEM PROMPT ADMIN ─────────────────────────────────────────────────────
const SYSTEM_ADMIN = `Tu es Braksoo, l'IA du serveur FiveM HorizonPvP. Tu parles en français, tu es sympa et efficace.

Tu peux exécuter des commandes sur le serveur FiveM. Quand l'admin te demande quelque chose, réponds UNIQUEMENT avec du JSON valide.

COMMANDES DISPONIBLES :
- giveitem    : donner un item          | params: player, item, count
- givemoney   : donner de l'argent      | params: player, type(money/bank/black_money), amount
- jail        : mettre en prison        | params: player, duration(minutes), reason
- unjail      : libérer de prison       | params: player
- kick        : expulser                | params: player, reason
- ban         : bannir                  | params: player, reason, duration(ex: "7j","30j","permanent")
- warn        : avertir                 | params: player, reason
- teleport    : téléporter              | params: player, x, y, z
- setjob      : changer métier          | params: player, job, grade
- revive      : réanimer                | params: player
- freeze      : geler/dégeler           | params: player, freeze(true/false)
- announce    : annonce à tous          | params: message
- players     : liste joueurs connectés | params: (aucun)

FORMAT quand il faut exécuter une commande :
{"action":true,"command":"giveitem","params":{"player":"3","item":"weapon_pistol50","count":2},"message":"Je donne 2 weapon_pistol50 au joueur ID 3 !"}

FORMAT quand c'est juste une conversation :
{"action":false,"message":"Ta réponse ici"}

RÈGLES :
- Comprends le langage naturel : "give 2 pistol au 3" = giveitem player=3 item=weapon_pistol50 count=2
- Noms d'items courants : "pistol"/"pistol50" -> weapon_pistol50, "rifle"/"ak" -> weapon_assaultrifle, "smg" -> weapon_microsmg, "black money"/"bm" -> black_money
- IDs : "ID 3", "le 3", "joueur 3", "src 3" -> player="3"
- Durées jail : "10min"->10, "1h"->60, "30 minutes"->30
- TOUJOURS répondre en JSON valide uniquement, rien d'autre avant ou après`;

// ─── SYSTEM PROMPT TICKET ─────────────────────────────────────────────────────
const SYSTEM_TICKET = `Tu es Braksoo, l'assistant IA du serveur FiveM HorizonPvP. Tu parles en français, tu es sympa et professionnel.

RÔLE : Aider les joueurs dans leur ticket avant de passer au staff humain.

CONTEXTE SERVEUR :
- FiveM ESX — HorizonPvP
- Commandes : /loot, /porter, /weaponmarket, /report, /squad, /r (revive ramp), /time, /leaderboard
- Touches : G=revive, F1=daily reward, F3=boutique, F4=kevlar, F5=menu, F6=modif arme

CE QUE TU PEUX RÉSOUDRE :
- Questions sur commandes/touches
- Explications des règles et fonctionnalités
- Aide générale sur le serveur
- Orienter le joueur vers la bonne solution

CE QUI NÉCESSITE LE STAFF (termine par ##TRANSFER_TO_STAFF##) :
- Remboursements d'items ou d'argent
- Ban appeal / demande de déban
- Bugs techniques nécessitant accès serveur
- Signalement de joueur avec preuves
- Problèmes de boutique / paiement
- Demandes de grade ou de rôle

STYLE : Sois concis (2-3 phrases max), sympa, et efficace. Pas de longs pavés.`;

// ─── APPEL API GEMINI ─────────────────────────────────────────────────────────
async function callGemini(systemPrompt, messages, maxTokens) {
    maxTokens = maxTokens || 500;

    // Gemini utilise un format différent d'Anthropic
    // On combine system + historique en un seul tableau de contents
    const contents = [];

    // Ajouter le system prompt comme premier message user (Gemini Flash supporte systemInstruction)
    const body = {
        systemInstruction: {
            parts: [{ text: systemPrompt }]
        },
        contents: messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
        })),
        generationConfig: {
            maxOutputTokens: maxTokens,
            temperature: 0.7,
        },
        safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ],
    };

    const response = await fetch(GEMINI_URL + GEMINI_API_KEY, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error('Erreur API Gemini : ' + err.slice(0, 200));
    }

    const data = await response.json();

    // Extraire le texte de la réponse Gemini
    if (!data.candidates || !data.candidates[0]) {
        throw new Error('Réponse Gemini vide ou bloquée');
    }

    return data.candidates[0].content.parts[0].text;
}

// ─── IA ADMIN (commandes FiveM) ───────────────────────────────────────────────
async function handleAdminAI(userMessage, userId) {
    if (!conversationHistory.has(userId)) {
        conversationHistory.set(userId, []);
    }
    const history = conversationHistory.get(userId);

    history.push({ role: 'user', content: userMessage });

    // Max 10 messages d'historique
    if (history.length > 10) history.splice(0, history.length - 10);

    const raw = await callGemini(SYSTEM_ADMIN, history, 600);

    history.push({ role: 'assistant', content: raw });

    // Nettoyer et parser le JSON
    const clean = raw
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();

    let parsed;
    try {
        parsed = JSON.parse(clean);
    } catch (_) {
        // Essayer d'extraire le JSON si Gemini a mis du texte autour
        const match = clean.match(/\{[\s\S]*\}/);
        if (match) {
            try { parsed = JSON.parse(match[0]); }
            catch (_) { return { action: false, message: raw }; }
        } else {
            return { action: false, message: raw };
        }
    }

    return parsed;
}

// ─── IA TICKET (support joueurs) ──────────────────────────────────────────────
async function handleTicketAI(channelId, userMessage, userName) {
    if (!conversationHistory.has(channelId)) {
        conversationHistory.set(channelId, []);
    }
    const history = conversationHistory.get(channelId);

    history.push({
        role:    'user',
        content: `[${userName}]: ${userMessage}`,
    });

    // Max 20 messages
    if (history.length > 20) history.splice(0, history.length - 20);

    const raw = await callGemini(SYSTEM_TICKET, history, 400);

    history.push({ role: 'assistant', content: raw });

    const needsTransfer = raw.includes('##TRANSFER_TO_STAFF##');
    const message       = raw.replace('##TRANSFER_TO_STAFF##', '').trim();

    return { message, needsTransfer };
}

// ─── MESSAGE D'ACCUEIL TICKET ─────────────────────────────────────────────────
async function getTicketWelcome(category, userName) {
    try {
        const prompt = `Génère un message d'accueil court (2-3 phrases) pour ${userName} qui ouvre un ticket catégorie "${category}" sur le serveur FiveM HorizonPvP. Sois sympa et indique que tu vas essayer d'aider avant de passer au staff. Réponds uniquement le message, pas de JSON.`;

        const msg = await callGemini(
            'Tu es Braksoo, l\'IA du serveur HorizonPvP. Tu parles en français et tu es sympa.',
            [{ role: 'user', content: prompt }],
            200
        );
        return msg.trim();
    } catch (_) {
        return `Bonjour **${userName}** ! 👋 Je suis Braksoo, l'IA du serveur HorizonPvP. Je vais essayer de t'aider avec ta demande dans la catégorie **${category}**. Si je ne peux pas résoudre ton problème, je ferai appel au staff !`;
    }
}

// ─── NETTOYER HISTORIQUE ──────────────────────────────────────────────────────
function clearHistory(id) {
    conversationHistory.delete(id);
}

module.exports = { handleAdminAI, handleTicketAI, getTicketWelcome, clearHistory };
