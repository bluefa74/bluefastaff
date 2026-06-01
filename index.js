require('dotenv').config();

const { handleAdminAI, handleTicketAI, getTicketWelcome, clearHistory } = require('./ai');

const {
  Client, GatewayIntentBits, Partials, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ChannelType, PermissionFlagsBits,
  SlashCommandBuilder, REST, Routes, AttachmentBuilder, MessageFlags,
} = require('discord.js');
const fs   = require('fs');
const path = require('path');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember],
});

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CONFIG = {
  TOKEN:             process.env.DISCORD_TOKEN,
  CLIENT_ID:         process.env.CLIENT_ID,
  PANEL_CHANNEL_ID:  '1493323127902703829',
  STAFF_ROLE_ID:     '1505217107112104056',
  LOGS_CHANNEL_ID:   process.env.LOGS_CHANNEL_ID   || '',
  GIVEAWAY_CHANNEL:  '1502778049207341087',
  VOCAL_HUB_ID:      '1493323047258685566',
  VOCAL_CATEGORY_ID: '1493323013054267443',
  TOUCHE_CHANNEL_ID: '1503178837159055420',
  WELCOME_CHANNEL_ID:'1493323050903670804',
  FIVEM_IP:          process.env.FIVEM_IP,
  FIVEM_PORT:        process.env.FIVEM_PORT         || '30062',
  FIVEM_API_KEY:     process.env.FIVEM_API_KEY,
  FIVEM_ROLE_ID:     process.env.FIVEM_ROLE_ID      || '',
};

// ─── FIVEM HTTP ───────────────────────────────────────────────────────────────
async function fivemRequest(endpoint, method, body) {
  method = method || 'GET';
  const url = 'http://' + CONFIG.FIVEM_IP + ':' + CONFIG.FIVEM_PORT + '/discord_bridge' + endpoint;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'x-api-key': CONFIG.FIVEM_API_KEY },
  };
  if (body) opts.body = JSON.stringify(body);
  const res  = await fetch(url, opts);
  const text = await res.text();
  try { return JSON.parse(text); }
  catch (_) {
    console.error('[FiveM] Non-JSON depuis ' + url + ' :', text.slice(0, 200));
    throw new Error('Reponse invalide du serveur FiveM : ' + text.slice(0, 100));
  }
}

function hasFivemPerm(member) {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (CONFIG.FIVEM_ROLE_ID && member.roles.cache.has(CONFIG.FIVEM_ROLE_ID)) return true;
  return false;
}

// ─── DASHBOARD — NOTIF CLAIM ─────────────────────────────────────────────────
async function notifyClaimToDashboard(userId, username, ticketId, ticketName, category) {
  try {
    const DASHBOARD_URL    = process.env.DASHBOARD_URL || 'http://localhost:3000';
    const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;
    if (!INTERNAL_API_KEY) return;
    await fetch(`${DASHBOARD_URL}/api/bot/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': INTERNAL_API_KEY,
      },
      body: JSON.stringify({ userId, username, ticketId, ticketName, category }),
    });
  } catch (err) {
    console.error('[Dashboard] Erreur notification claim:', err.message);
  }
}

// ─── TICKET CATEGORIES ────────────────────────────────────────────────────────
const TICKET_CATEGORIES = [
  { label:'Général',         value:'general',       description:'Toutes demandes ou questions générales' },
  { label:'Remboursement',   value:'remboursement', description:'Toute demande de remboursement' },
  { label:'Deban/Unjail',    value:'deban',         description:"Demande de déban ou d'unjail" },
  { label:'Team Officielle', value:'team',          description:"Contacter l'équipe des Teams" },
  { label:'Staff',           value:'staff',         description:"Contacter l'équipe Staff" },
  { label:'Evenement',       value:'evenement',     description:"Contacter l'équipe événementielle" },
  { label:'Community',       value:'community',     description:"Contacter l'équipe Community Manager" },
  { label:'Fondateurs',      value:'fondateurs',    description:'Contacter les Fondateurs' },
  { label:'Developpeur',     value:'developpeur',   description:'Remonter un bug ou autre demande' },
  { label:'Boutique',        value:'boutique',      description:'Toute demande concernant la boutique' },
];
const TICKET_LABELS = {
  general:'⚙️ Général', remboursement:'💰 Remboursement', deban:'⚖️ Deban/Unjail',
  team:'🧪 Team Officielle', staff:'💼 Staff', evenement:'🎉 Événement',
  community:'📣 Community', fondateurs:'🛡️ Fondateurs', developpeur:'💻 Développeur', boutique:'🛒 Boutique',
};
const CATEGORY_EMOJI = {
  general:'⚙️', remboursement:'💰', deban:'⚖️', team:'🧪',
  staff:'💼', evenement:'🎉', community:'📣', fondateurs:'🛡️', developpeur:'💻', boutique:'🛒',
};

// ─── STORAGE ─────────────────────────────────────────────────────────────────
const TICKETS_FILE  = path.join(__dirname, 'tickets.json');
const GIVEAWAY_FILE = path.join(__dirname, 'giveaways.json');
function loadTickets()    { if (!fs.existsSync(TICKETS_FILE))  fs.writeFileSync(TICKETS_FILE,  '{}'); return JSON.parse(fs.readFileSync(TICKETS_FILE,  'utf8')); }
function saveTickets(d)   { fs.writeFileSync(TICKETS_FILE,  JSON.stringify(d, null, 2)); }
function loadGiveaways()  { if (!fs.existsSync(GIVEAWAY_FILE)) fs.writeFileSync(GIVEAWAY_FILE, '{}'); return JSON.parse(fs.readFileSync(GIVEAWAY_FILE, 'utf8')); }
function saveGiveaways(d) { fs.writeFileSync(GIVEAWAY_FILE, JSON.stringify(d, null, 2)); }

const privateVocals = new Map();

// ─── SLASH COMMANDS ───────────────────────────────────────────────────────────
async function registerCommands(guildId) {
  const commands = [
    new SlashCommandBuilder().setName('panel').setDescription('Envoyer le panel de tickets'),
    new SlashCommandBuilder().setName('renameticket').setDescription('Renommer le ticket actuel')
      .addStringOption(o => o.setName('nom').setDescription('Nouveau nom').setRequired(true)),
    new SlashCommandBuilder().setName('switchcat').setDescription('Changer la categorie du ticket')
      .addStringOption(o => o.setName('categorie').setDescription('Nouvelle categorie').setRequired(true)
        .addChoices(...TICKET_CATEGORIES.map(c => ({ name: c.label, value: c.value })))),
    new SlashCommandBuilder().setName('close').setDescription('Fermer le ticket actuel'),
    new SlashCommandBuilder().setName('giveaway').setDescription('Lancer un giveaway')
      .addStringOption(o => o.setName('lot').setDescription('Ce que lon gagne').setRequired(true))
      .addIntegerOption(o => o.setName('duree').setDescription('Duree en minutes').setRequired(true))
      .addIntegerOption(o => o.setName('gagnants').setDescription('Nombre de gagnants').setRequired(true)),
    new SlashCommandBuilder().setName('touche').setDescription('Envoyer le panel Touches et Commandes HorizonPvP'),
    new SlashCommandBuilder().setName('braksoo').setDescription('[IA] Parle a Braksoo, l IA du serveur')
      .addStringOption(o => o.setName('message').setDescription('Ce que tu veux dire a Braksoo').setRequired(true)),
    new SlashCommandBuilder().setName('braksooreset').setDescription('[IA] Reinitialiser la conversation avec Braksoo'),

    // ── FiveM ──
    new SlashCommandBuilder().setName('players').setDescription('[FiveM] Liste des joueurs connectes'),
    new SlashCommandBuilder().setName('fivemjail').setDescription('[FiveM] Mettre un joueur en prison')
      .addStringOption(o => o.setName('joueur').setDescription('Nom ou ID').setRequired(true))
      .addIntegerOption(o => o.setName('duree').setDescription('Duree en minutes').setRequired(true))
      .addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(false)),
    new SlashCommandBuilder().setName('fivemunjail').setDescription('[FiveM] Liberer un joueur de prison')
      .addStringOption(o => o.setName('joueur').setDescription('Nom ou ID').setRequired(true)),
    new SlashCommandBuilder().setName('fivemwarn').setDescription('[FiveM] Avertir un joueur IG')
      .addStringOption(o => o.setName('joueur').setDescription('Nom ou ID').setRequired(true))
      .addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(true)),
    new SlashCommandBuilder().setName('fivemkick').setDescription('[FiveM] Kick un joueur du serveur')
      .addStringOption(o => o.setName('joueur').setDescription('Nom ou ID').setRequired(true))
      .addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(false)),
    new SlashCommandBuilder().setName('fivemban').setDescription('[FiveM] Bannir un joueur')
      .addStringOption(o => o.setName('joueur').setDescription('Nom ou ID').setRequired(true))
      .addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(true))
      .addStringOption(o => o.setName('duree').setDescription('Duree (7j, 30j, permanent)').setRequired(false)),
    new SlashCommandBuilder().setName('fivemunban').setDescription('[FiveM] Debannir via license FiveM')
      .addStringOption(o => o.setName('license').setDescription('License FiveM (abc123 ou license:abc123)').setRequired(true)),
    new SlashCommandBuilder().setName('fivemannonce').setDescription('[FiveM] Annonce a tous les joueurs IG')
      .addStringOption(o => o.setName('message').setDescription('Message').setRequired(true)),
    new SlashCommandBuilder().setName('fivemgiveitem').setDescription('[FiveM] Donner un item a un joueur')
      .addStringOption(o => o.setName('joueur').setDescription('Nom ou ID').setRequired(true))
      .addStringOption(o => o.setName('item').setDescription('Nom item ESX').setRequired(true))
      .addIntegerOption(o => o.setName('quantite').setDescription('Quantite').setRequired(true)),
    new SlashCommandBuilder().setName('fivemsetjob').setDescription('[FiveM] Changer le metier')
      .addStringOption(o => o.setName('joueur').setDescription('Nom ou ID').setRequired(true))
      .addStringOption(o => o.setName('metier').setDescription('Nom metier').setRequired(true))
      .addIntegerOption(o => o.setName('grade').setDescription('Grade (defaut 0)').setRequired(false)),
    new SlashCommandBuilder().setName('fivemteleport').setDescription('[FiveM] Teleporter un joueur')
      .addStringOption(o => o.setName('joueur').setDescription('Nom ou ID').setRequired(true))
      .addNumberOption(o => o.setName('x').setDescription('X').setRequired(true))
      .addNumberOption(o => o.setName('y').setDescription('Y').setRequired(true))
      .addNumberOption(o => o.setName('z').setDescription('Z').setRequired(true)),
    new SlashCommandBuilder().setName('fivemrevive').setDescription('[FiveM] Reanimer un joueur')
      .addStringOption(o => o.setName('joueur').setDescription('Nom ou ID').setRequired(true)),
    new SlashCommandBuilder().setName('fivemfreeze').setDescription('[FiveM] Geler ou degeler un joueur')
      .addStringOption(o => o.setName('joueur').setDescription('Nom ou ID').setRequired(true))
      .addStringOption(o => o.setName('action').setDescription('freeze ou unfreeze').setRequired(true)
        .addChoices({ name: 'Freeze (geler)', value: 'freeze' }, { name: 'Unfreeze (degeler)', value: 'unfreeze' })),
    new SlashCommandBuilder().setName('fivemgivemoney').setDescription('[FiveM] Donner de l argent a un joueur')
      .addStringOption(o => o.setName('joueur').setDescription('Nom ou ID').setRequired(true))
      .addStringOption(o => o.setName('type').setDescription('Type').setRequired(true)
        .addChoices({ name: 'Cash', value: 'money' }, { name: 'Banque', value: 'bank' }, { name: 'Black Money', value: 'black_money' }))
      .addIntegerOption(o => o.setName('montant').setDescription('Montant').setRequired(true)),
    new SlashCommandBuilder().setName('fivemsetcoords').setDescription('[FiveM] Teleporter un joueur a des coords predefinies')
      .addStringOption(o => o.setName('joueur').setDescription('Nom ou ID').setRequired(true))
      .addStringOption(o => o.setName('lieu').setDescription('Lieu').setRequired(true)
        .addChoices(
          { name: 'Prison', value: 'prison' },
          { name: 'Hopital', value: 'hopital' },
          { name: 'Mairie', value: 'mairie' },
          { name: 'Aeroport', value: 'aeroport' },
        )),
    new SlashCommandBuilder().setName('fivemspectate').setDescription('[FiveM] Espionner un joueur IG (spectate)')
      .addStringOption(o => o.setName('joueur').setDescription('Nom ou ID').setRequired(true)),
    new SlashCommandBuilder().setName('serverinfo').setDescription('[FiveM] Infos du serveur (joueurs, uptime)'),
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(CONFIG.TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(CONFIG.CLIENT_ID, guildId), { body: commands });
    console.log('Commandes slash enregistrees.');
  } catch (err) { console.error('Erreur commandes:', err); }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function findDiscordCategory(guild, catValue) {
  const catDef = TICKET_CATEGORIES.find(c => c.value === catValue);
  if (catDef?.discordCategoryId) {
    const ch = guild.channels.cache.get(catDef.discordCategoryId);
    if (ch && ch.type === ChannelType.GuildCategory) return ch;
  }
  return guild.channels.cache.find(c => {
    if (c.type !== ChannelType.GuildCategory) return false;
    const name = c.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const kw   = catValue.toLowerCase().replace(/[^a-z0-9]/g, '');
    return name.includes(kw);
  }) || null;
}

function fivemEmbed(title, desc, ok) {
  if (ok === undefined) ok = true;
  return new EmbedBuilder().setTitle(title).setDescription(desc)
    .setColor(ok ? 0x57F287 : 0xED4245).setFooter({ text: 'HorizonPvP — FiveM' }).setTimestamp();
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── PANEL TICKETS ────────────────────────────────────────────────────────────
async function sendPanel(channel) {
  const embed = new EmbedBuilder()
    .setTitle('🎫 Système de Tickets')
    .setDescription(
      '⚙️ **Général** : Pour toutes demandes ou questions générales\n' +
      '💰 **Remboursement** : Pour toute demande de remboursement\n' +
      '⚖️ **Deban/Unjail** : Pour toute demande de déban ou d\'unjail\n' +
      '🧪 **Team Officielle** : Pour contacter l\'équipe des Teams\n' +
      '💼 **Staff** : Pour contacter l\'équipe Staff\n' +
      '🎉 **Événement** : Pour contacter l\'équipe événementielle\n' +
      '📣 **Community** : Pour contacter l\'équipe Community Manager\n' +
      '🛡️ **Fondateurs** : Pour contacter les Fondateurs\n' +
      '💻 **Développeur** : Pour remonter un bug ou toute autre demande\n' +
      '🛒 **Boutique** : Pour toute demande concernant la boutique'
    )
    .setColor(0x5865F2).setFooter({ text: 'Sélectionnez une catégorie pour ouvrir un ticket' }).setTimestamp();

  const select = new StringSelectMenuBuilder()
    .setCustomId('ticket_select').setPlaceholder('📂 Sélectionner une catégorie')
    .addOptions(TICKET_CATEGORIES.map(c => ({ label: TICKET_LABELS[c.value]||c.label, value: c.value, description: c.description })));

  await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] });
}

// ─── TRANSCRIPT ───────────────────────────────────────────────────────────────
async function generateTranscript(channel, td) {
  const msgs = await channel.messages.fetch({ limit: 100 });
  const rows = [...msgs.values()].reverse().map(m =>
    `<div class="message${m.author.bot?' bot':''}">
      <img class="avatar" src="https://cdn.discordapp.com/avatars/${m.author.id}/${m.author.avatar}.png?size=32" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'"/>
      <div class="content"><span class="author">${escapeHtml(m.author.tag)}</span>
      <span class="time">${m.createdAt.toLocaleString('fr-FR')}</span>
      <div class="text">${escapeHtml(m.content||'[Embed ou fichier]')}</div></div></div>`
  ).join('');
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/><title>Transcript</title>
<style>body{background:#36393f;color:#dcddde;font-family:'Segoe UI',sans-serif;padding:20px}
h1{color:#fff;border-bottom:2px solid #5865F2;padding-bottom:10px}
.info{background:#2f3136;padding:12px;border-radius:8px;margin-bottom:20px;font-size:.9em;color:#b9bbbe}
.message{display:flex;gap:12px;padding:8px 0;border-bottom:1px solid #40444b}
.avatar{width:32px;height:32px;border-radius:50%;flex-shrink:0}
.author{font-weight:700;color:#fff;margin-right:8px}.time{font-size:.78em;color:#72767d}
.text{margin-top:4px;white-space:pre-wrap}.bot .author{color:#5865F2}
footer{margin-top:20px;font-size:.8em;color:#72767d;text-align:center}</style></head><body>
<h1>🎫 Transcript</h1>
<div class="info"><strong>Salon:</strong> #${escapeHtml(channel.name)}<br/>
<strong>Catégorie:</strong> ${td?.category||'N/A'}<br/><strong>Ouvert par:</strong> ${escapeHtml(td?.openerTag||'?')}<br/>
<strong>Fermeture:</strong> ${new Date().toLocaleString('fr-FR')}</div>
${rows}<footer>Transcript • ${new Date().toLocaleString('fr-FR')}</footer></body></html>`;
}

// ─── CLOSE TICKET ─────────────────────────────────────────────────────────────
async function closeTicket(channel, guild, initiator) {
  const tickets = loadTickets();
  const td = tickets[channel.id];
  if (!td) return;
  const html = await generateTranscript(channel, td);
  const tmp  = path.join(__dirname, `transcript-${channel.id}.html`);
  fs.writeFileSync(tmp, html);
  const att = () => new AttachmentBuilder(tmp, { name: `transcript-${channel.name}.html` });
  try { const opener = await guild.members.fetch(td.openerId); await opener.send({ content: `📄 Votre ticket **#${channel.name}** a été fermé.`, files: [att()] }); } catch (_) {}
  if (CONFIG.LOGS_CHANNEL_ID) {
    try {
      const lc = await guild.channels.fetch(CONFIG.LOGS_CHANNEL_ID);
      await lc.send({ embeds: [new EmbedBuilder().setTitle('📋 Ticket Fermé').setColor(0xED4245)
        .addFields({ name: 'Salon', value: `#${channel.name}`, inline: true }, { name: 'Catégorie', value: td.category||'N/A', inline: true },
          { name: 'Ouvert par', value: td.openerTag||'?', inline: true }, { name: 'Fermé par', value: initiator?.tag||'?', inline: true }).setTimestamp()],
        files: [att()] });
    } catch (_) {}
  }
  delete tickets[channel.id]; saveTickets(tickets);
  await channel.send('🔒 Fermeture dans 5 secondes...');
  setTimeout(() => { channel.delete().catch(()=>{}); try{fs.unlinkSync(tmp);}catch(_){} }, 5000);
}

// ─── OPEN TICKET ──────────────────────────────────────────────────────────────
async function openTicket(guild, member, catValue) {
  const label  = TICKET_LABELS[catValue] || catValue;
  const emoji  = CATEGORY_EMOJI[catValue] || '🎫';
  const tickets = loadTickets();
  const existing = Object.values(tickets).find(t => t.openerId === member.id && t.category === label);
  if (existing && guild.channels.cache.get(existing.channelId)) return { error: `Ticket déjà ouvert : <#${existing.channelId}>` };
  const discordCat = findDiscordCategory(guild, catValue);
  const num = Object.keys(tickets).length + 1;
  const chName = `ticket-${catValue.slice(0,8)}-${member.user.username}`
    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9-]/g,'').slice(0,45);
  const ch = await guild.channels.create({
    name: chName, type: ChannelType.GuildText, parent: discordCat?.id||null,
    permissionOverwrites: [
      { id: guild.id,             deny:  [PermissionFlagsBits.ViewChannel] },
      { id: member.id,            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: CONFIG.STAFF_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    ],
  });
  tickets[ch.id] = { channelId: ch.id, openerId: member.id, openerTag: member.user.tag, category: label, claimedBy: null, createdAt: new Date().toISOString() };
  saveTickets(tickets);
  await ch.send({
    content: `<@${member.id}> | <@&${CONFIG.STAFF_ROLE_ID}>`,
    embeds: [new EmbedBuilder().setTitle(`${emoji} Ticket — ${label}`)
      .setDescription(`Bienvenue <@${member.id}> !\n\nMerci d'avoir ouvert un ticket dans la catégorie **${label}**.\nUn membre du staff va vous répondre dès que possible.\n\n> Décrivez votre demande en détail.`)
      .setColor(0x5865F2).setFooter({ text: `Ticket #${num}` }).setTimestamp()],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_close').setLabel('🔒 Fermer').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('ticket_claim').setLabel('✋ Claim').setStyle(ButtonStyle.Success),
    )],
  });

  // ── IA BRAKSOO : accueil automatique dans le ticket ──
  if (process.env.GROQ_API_KEY) {
    try {
      const aiWelcome = await getTicketWelcome(label, member.user.username);
      await ch.send({ embeds: [new EmbedBuilder()
        .setAuthor({ name: '🤖 Braksoo — IA HorizonPvP' })
        .setDescription(aiWelcome)
        .setColor(0x9B59B6)
        .setFooter({ text: 'Braksoo IA • Décrivez votre problème et je vais essayer de vous aider !' })] });
    } catch (e) { console.error('AI welcome error:', e.message); }
  }

  return { channel: ch };
}

// ─── GIVEAWAY ─────────────────────────────────────────────────────────────────
async function startGiveaway(guild, lot, dureeMin, nbGagnants, startedBy) {
  const ch = await guild.channels.fetch(CONFIG.GIVEAWAY_CHANNEL).catch(()=>null);
  if (!ch) throw new Error('Salon giveaway introuvable.');
  const endsAt = Date.now() + dureeMin * 60000;
  const msg = await ch.send({
    embeds: [new EmbedBuilder().setTitle('🎉 GIVEAWAY 🎉')
      .setDescription(`**Lot :** ${lot}\n\n**Gagnants :** ${nbGagnants}\n**Fin :** <t:${Math.floor(endsAt/1000)}:R>\n\nCliquez sur 🎉 pour participer !\n\n👥 **0** participant(s)`)
      .setColor(0xFF73FA).setFooter({ text: `Lancé par ${startedBy.tag}` }).setTimestamp(endsAt)],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('giveaway_enter').setLabel('🎉 Participer').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('giveaway_list').setLabel('👥 Participants').setStyle(ButtonStyle.Secondary),
    )],
  });
  const gws = loadGiveaways();
  gws[msg.id] = { messageId: msg.id, channelId: ch.id, lot, nbGagnants, endsAt, participants: [], ended: false };
  saveGiveaways(gws);
  setTimeout(() => endGiveaway(guild, msg.id), dureeMin * 60000);
}

async function endGiveaway(guild, msgId) {
  const gws = loadGiveaways(); const gw = gws[msgId];
  if (!gw || gw.ended) return;
  gw.ended = true; saveGiveaways(gws);
  const ch = await guild.channels.fetch(gw.channelId).catch(()=>null); if (!ch) return;
  const msg = await ch.messages.fetch(msgId).catch(()=>null); if (!msg) return;
  const winners = gw.participants.length > 0
    ? [...gw.participants].sort(()=>Math.random()-.5).slice(0, Math.min(gw.nbGagnants, gw.participants.length)) : [];
  const wText = winners.length > 0 ? winners.map(id=>`<@${id}>`).join(', ') : 'Aucun participant';
  await msg.edit({ embeds: [new EmbedBuilder().setTitle('🎉 GIVEAWAY TERMINÉ 🎉').setDescription(`**Lot :** ${gw.lot}\n\n**Gagnant(s) :** ${wText}`).setColor(0xED4245).setTimestamp()],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('giveaway_enter').setLabel('🎉 Terminé').setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId('giveaway_list').setLabel('👥 Participants').setStyle(ButtonStyle.Secondary).setDisabled(true),
    )] }).catch(()=>{});
  await ch.send(winners.length > 0 ? `🎊 Félicitations ${wText} ! Vous avez gagné **${gw.lot}** !` : "😢 Personne n'a participé.");
}

// ─── VOCAL PRIVE ──────────────────────────────────────────────────────────────
async function createPrivateVoice(guild, member) {
  const ch = await guild.channels.create({
    name: `BDA DE ${member.user.username}`, type: ChannelType.GuildVoice,
    parent: CONFIG.VOCAL_CATEGORY_ID,
    permissionOverwrites: [
      { id: guild.id,             deny:  [PermissionFlagsBits.ViewChannel] },
      { id: member.id,            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.ManageChannels] },
      { id: CONFIG.STAFF_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] },
    ],
  });
  privateVocals.set(ch.id, member.id);
  await member.voice.setChannel(ch).catch(()=>{});
}

// ─── WELCOME MESSAGE ──────────────────────────────────────────────────────────
async function sendWelcome(guild, member) {
  try {
    const welcomeChannel = await guild.channels.fetch(CONFIG.WELCOME_CHANNEL_ID).catch(()=>null);
    if (!welcomeChannel) return;

    const accountCreated = member.user.createdAt;
    const now = new Date();
    const diffMs    = now - accountCreated;
    const diffDays  = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffMonths= Math.floor(diffDays / 30);
    const diffYears = Math.floor(diffDays / 365);

    let accountAge;
    if (diffYears > 0)       accountAge = `${diffYears} an${diffYears > 1 ? 's' : ''}`;
    else if (diffMonths > 0) accountAge = `${diffMonths} mois`;
    else                     accountAge = `${diffDays} jour${diffDays > 1 ? 's' : ''}`;

    const memberCount = guild.memberCount;

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setDescription(
        `<@${member.id}>, vient de nous rejoindre pour la **1ère** fois, son compte a été créé il y a **${accountAge}**.\n` +
        `Nous sommes désormais **${memberCount}** sur le serveur !`
      )
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
      .setTimestamp();

    await welcomeChannel.send({ content: `<@${member.id}>`, embeds: [embed] });
  } catch (err) {
    console.error('Erreur welcome:', err);
  }
}

// ─── READY ───────────────────────────────────────────────────────────────────
client.once('clientReady', async () => {
  console.log(`Connecte : ${client.user.tag}`);
  const guild = client.guilds.cache.first();
  if (guild) {
    await registerCommands(guild.id);
    const gws = loadGiveaways();
    for (const [id, gw] of Object.entries(gws)) {
      if (gw.ended) continue;
      const rem = gw.endsAt - Date.now();
      if (rem <= 0) endGiveaway(guild, id);
      else setTimeout(() => endGiveaway(guild, id), rem);
    }
  }
});

// ─── WELCOME EVENT ────────────────────────────────────────────────────────────
client.on('guildMemberAdd', async member => {
  await sendWelcome(member.guild, member);
});

// ─── IA DANS LES TICKETS — écoute les messages des joueurs ───────────────────
client.on('messageCreate', async msg => {
  if (msg.author.bot) return;

  // Auto-ban salon protégé
  if (msg.channel.id === CONFIG.TOUCHE_CHANNEL_ID) {
    try {
      await msg.delete().catch(()=>{});
      const member = msg.member || await msg.guild.members.fetch(msg.author.id).catch(()=>null);
      if (!member || member.permissions.has(PermissionFlagsBits.Administrator)) return;
      await msg.guild.members.ban(msg.author.id, { deleteMessageSeconds: 0, reason: 'Message dans salon protégé.' });
      setTimeout(async () => { await msg.guild.members.unban(msg.author.id).catch(()=>{}); }, 14*24*60*60*1000);
    } catch (err) { console.error('Auto-ban:', err); }
    return;
  }

  // IA dans les tickets
  if (!process.env.GROQ_API_KEY) return;

  await new Promise(r => setTimeout(r, 500));

  const tickets = loadTickets();
  const td = tickets[msg.channel.id];
  if (!td) return;

  if (msg.member) {
    const perms = msg.member.permissions;
    if (perms.has(PermissionFlagsBits.ManageMessages) || perms.has(PermissionFlagsBits.ManageGuild) || perms.has(PermissionFlagsBits.Administrator)) return;
    if (CONFIG.STAFF_ROLE_ID && msg.member.roles.cache.has(CONFIG.STAFF_ROLE_ID)) return;
    if (td.openerId && msg.author.id !== td.openerId) return;
  }

  await msg.channel.sendTyping().catch(()=>{});
  const typingInterval = setInterval(() => msg.channel.sendTyping().catch(()=>{}), 8000);

  try {
    const result = await handleTicketAI(msg.channel.id, msg.content, msg.author.username);

    const aiEmbed = new EmbedBuilder()
      .setAuthor({ name: '🤖 Braksoo — IA HorizonPvP' })
      .setDescription(result.message)
      .setColor(result.needsTransfer ? 0xED4245 : result.refundData ? 0x57F287 : 0x9B59B6)
      .setTimestamp();

    if (result.needsTransfer) {
      aiEmbed.setFooter({ text: '🔔 Transfert au staff en cours...' });
      await msg.channel.send({ embeds: [aiEmbed] });
      const transferEmbed = new EmbedBuilder()
        .setTitle('🔔 Transfert de ticket')
        .setDescription(`L'IA Braksoo a détecté une demande suspecte ou complexe de <@${msg.author.id}>.\nUn staff doit vérifier et intervenir.`)
        .setColor(0xF39C12).setTimestamp();
      await msg.channel.send({ content: `<@&${CONFIG.STAFF_ROLE_ID}>`, embeds: [transferEmbed] });
      clearHistory(msg.channel.id);

    } else if (result.refundData) {
      const rd = result.refundData;
      aiEmbed.setFooter({ text: '✅ Remboursement en cours...' });
      await msg.channel.send({ embeds: [aiEmbed] });
      try {
        let fivemData;
        if (rd.type === 'item') {
          fivemData = await fivemRequest('/giveitem', 'POST', { player: rd.playerId, item: rd.item, count: rd.count || 1 });
        } else if (rd.type === 'money') {
          fivemData = await fivemRequest('/givemoney', 'POST', { player: rd.playerId, type: rd.moneyType || 'money', amount: rd.amount });
        }
        const ok = fivemData && fivemData.success;
        const refundEmbed = new EmbedBuilder()
          .setTitle(ok ? '✅ Remboursement effectué' : '❌ Remboursement échoué')
          .setDescription(ok
            ? `Remboursement envoyé au joueur **ID ${rd.playerId}**.\n` +
              (rd.type === 'item' ? `**Item :** ${rd.item} x${rd.count || 1}` : `**Montant :** ${rd.amount}$`)
            : `Remboursement automatique impossible.\n**Erreur :** ${fivemData?.error || 'Serveur FiveM inaccessible'}\nUn staff doit intervenir manuellement.`)
          .setColor(ok ? 0x57F287 : 0xED4245).setTimestamp();
        await msg.channel.send({ embeds: [refundEmbed] });
        if (!ok) await msg.channel.send({ content: `<@&${CONFIG.STAFF_ROLE_ID}> Le remboursement automatique a échoué, intervention manuelle requise.` });
      } catch (fivemErr) {
        console.error('Erreur remboursement FiveM:', fivemErr);
        const errEmbed = new EmbedBuilder()
          .setTitle('❌ Remboursement échoué')
          .setDescription(`Serveur FiveM inaccessible. Un staff va intervenir.\n**Détail :** ${fivemErr.message}`)
          .setColor(0xED4245).setTimestamp();
        await msg.channel.send({ embeds: [errEmbed] });
        await msg.channel.send({ content: `<@&${CONFIG.STAFF_ROLE_ID}> Remboursement automatique impossible, intervention requise.` });
      }

    } else {
      aiEmbed.setFooter({ text: 'Braksoo IA • Tapez votre message pour continuer' });
      await msg.channel.send({ embeds: [aiEmbed] });
    }
  } catch (e) {
    console.error('Erreur IA ticket:', e);
    await msg.channel.send({ content: '❌ Erreur IA : ' + e.message }).catch(()=>{});
  } finally {
    clearInterval(typingInterval);
  }
});

// ─── VOICE STATE ──────────────────────────────────────────────────────────────
client.on('voiceStateUpdate', async (old, nw) => {
  if (nw.channelId === CONFIG.VOCAL_HUB_ID && old.channelId !== CONFIG.VOCAL_HUB_ID)
    try { await createPrivateVoice(nw.guild, nw.member); } catch (e) { console.error(e); }
  if (old.channelId && privateVocals.has(old.channelId)) {
    try {
      const ch = await nw.guild.channels.fetch(old.channelId).catch(()=>null);
      if (ch && ch.members.size === 0) { privateVocals.delete(old.channelId); await ch.delete().catch(()=>{}); }
    } catch (e) { console.error(e); }
  }
});

// ─── INTERACTIONS ─────────────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  const guild = interaction.guild;

  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_select') {
    try {
      await interaction.reply({ content: 'Création du ticket...', flags: MessageFlags.Ephemeral });
      const r = await openTicket(guild, interaction.member, interaction.values[0]);
      if (r.error) return interaction.editReply({ content: r.error });
      await interaction.editReply({ content: `Ticket créé : <#${r.channel.id}>` });
    } catch (e) { console.error(e); try { await interaction.editReply({ content: 'Erreur.' }); } catch (_) {} }
    return;
  }

  if (interaction.isButton()) {
    const tickets = loadTickets();
    const td = tickets[interaction.channel?.id];

    if (interaction.customId === 'ticket_close') {
      try { await interaction.reply({ content: 'Fermeture...', flags: MessageFlags.Ephemeral }); await closeTicket(interaction.channel, guild, interaction.user); } catch (e) { console.error(e); }
      return;
    }

    if (interaction.customId === 'ticket_claim') {
      try {
        if (!td) return interaction.reply({ content: 'Pas un ticket.', flags: MessageFlags.Ephemeral });
        if (td.claimedBy) return interaction.reply({ content: `Déjà claim par <@${td.claimedBy}>.`, flags: MessageFlags.Ephemeral });

        // Enregistre le claim
        td.claimedBy = interaction.user.id;
        saveTickets(tickets);

        // Désactive le bouton claim
        await interaction.message.edit({ components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('ticket_close').setLabel('🔒 Fermer').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('ticket_claim').setLabel('✋ Claim').setStyle(ButtonStyle.Success).setDisabled(true),
        )] });

        await interaction.reply({ embeds: [new EmbedBuilder()
          .setDescription(`✋ <@${interaction.user.id}> a claim ce ticket.`)
          .setColor(0x57F287)] });

        // ── Notifie le dashboard Staff ──────────────────────────────────────
        await notifyClaimToDashboard(
          interaction.user.id,
          interaction.user.username,
          interaction.channel.id,
          interaction.channel.name,
          td.category || 'N/A'
        );

      } catch (e) { console.error(e); }
      return;
    }

    if (interaction.customId === 'giveaway_enter') {
      try {
        const gws = loadGiveaways(); const gw = gws[interaction.message.id];
        if (!gw || gw.ended) return interaction.reply({ content: 'Giveaway terminé.', flags: MessageFlags.Ephemeral });
        if (gw.participants.includes(interaction.user.id)) return interaction.reply({ content: 'Vous participez déjà !', flags: MessageFlags.Ephemeral });
        gw.participants.push(interaction.user.id); saveGiveaways(gws);
        await interaction.message.edit({ embeds: [EmbedBuilder.from(interaction.message.embeds[0])
          .setDescription(`**Lot :** ${gw.lot}\n\n**Gagnants :** ${gw.nbGagnants}\n**Fin :** <t:${Math.floor(gw.endsAt/1000)}:R>\n\nCliquez sur 🎉 pour participer !\n\n👥 **${gw.participants.length}** participant(s)`)] }).catch(()=>{});
        await interaction.reply({ content: '🎉 Vous participez !', flags: MessageFlags.Ephemeral });
      } catch (e) { console.error(e); }
      return;
    }

    if (interaction.customId === 'giveaway_list') {
      try {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator))
          return interaction.reply({ content: 'Réservé aux administrateurs.', flags: MessageFlags.Ephemeral });
        const gws = loadGiveaways(); const gw = gws[interaction.message.id];
        if (!gw || gw.participants.length === 0) return interaction.reply({ content: 'Aucun participant.', flags: MessageFlags.Ephemeral });
        const lines = [];
        for (const uid of gw.participants) {
          const m = await guild.members.fetch(uid).catch(()=>null);
          lines.push(`• ${m ? `${m.user.tag} (<@${uid}>)` : `ID: ${uid}`}`);
        }
        await interaction.reply({ embeds: [new EmbedBuilder().setTitle(`Participants — ${gw.lot}`)
          .setDescription(lines.join('\n').slice(0,4000)).setColor(0xFF73FA)
          .setFooter({ text: `Total : ${gw.participants.length}` })], flags: MessageFlags.Ephemeral });
      } catch (e) { console.error(e); }
      return;
    }
  }

  if (!interaction.isChatInputCommand()) return;
  const cmd = interaction.commandName;

  if (cmd === 'panel') {
    try {
      await interaction.reply({ content: 'Panel envoyé !', flags: MessageFlags.Ephemeral });
      const ch = await guild.channels.fetch(CONFIG.PANEL_CHANNEL_ID).catch(()=>null);
      if (ch) await sendPanel(ch);
    } catch (e) { console.error(e); } return;
  }
  if (cmd === 'renameticket') {
    try {
      const tickets = loadTickets();
      if (!tickets[interaction.channel.id]) return interaction.reply({ content: 'Pas un ticket.', flags: MessageFlags.Ephemeral });
      const name = interaction.options.getString('nom').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9-]/g,'-').slice(0,45);
      await interaction.reply({ content: 'Renommage...', flags: MessageFlags.Ephemeral });
      await interaction.channel.setName(name);
    } catch (e) { console.error(e); } return;
  }
  if (cmd === 'switchcat') {
    try {
      const tickets = loadTickets();
      if (!tickets[interaction.channel.id]) return interaction.reply({ content: 'Pas un ticket.', flags: MessageFlags.Ephemeral });
      const val = interaction.options.getString('categorie');
      const label = TICKET_LABELS[val]||val;
      tickets[interaction.channel.id].category = label; saveTickets(tickets);
      const dc = findDiscordCategory(guild, val);
      if (dc) await interaction.channel.setParent(dc.id, { lockPermissions: false });
      await interaction.reply({ content: `Catégorie changée : **${label}**.` });
    } catch (e) { console.error(e); } return;
  }
  if (cmd === 'close') {
    try {
      const tickets = loadTickets();
      if (!tickets[interaction.channel.id]) return interaction.reply({ content: 'Pas un ticket.', flags: MessageFlags.Ephemeral });
      await interaction.reply({ content: 'Fermeture...', flags: MessageFlags.Ephemeral });
      await closeTicket(interaction.channel, guild, interaction.user);
    } catch (e) { console.error(e); } return;
  }
  if (cmd === 'giveaway') {
    try {
      await interaction.reply({ content: 'Giveaway lancé !', flags: MessageFlags.Ephemeral });
      await startGiveaway(guild, interaction.options.getString('lot'), interaction.options.getInteger('duree'), interaction.options.getInteger('gagnants'), interaction.user);
    } catch (e) { console.error(e); } return;
  }
  if (cmd === 'touche') {
    try {
      await interaction.reply({ content: 'Panel envoyé !', flags: MessageFlags.Ephemeral });
      await interaction.channel.send({ embeds: [new EmbedBuilder()
        .setTitle('⌨️ Touches & Commandes HorizonPvP').setColor(0x5865F2).setTimestamp().setFooter({ text: 'HorizonPvP' })
        .addFields(
          { name: '📋 Commandes', value:
            '`/loot` — Permettre de loot un joueur\n`/porter` — Porter un joueur\n`/weaponmarket` — Menu vente d\'arme (Trade)\n`/report` — Report au staff\n`/squad` — Menu squad\n`/r` — Se revive en Ramp\n`/time` — Gérer le temps\n`/leaderboard` — Leaderboard' },
          { name: '⌨️ Touches', value:
            '`G` — Revive un joueur mort\n`F1` — DailyReward\n`F3` — Boutique\n`F4` — Équiper un kevlar\n`F5` — Menu F5\n`F6` — Menu modification arme' },
        )] });
    } catch (e) { console.error(e); } return;
  }

  // ── COMMANDES FIVEM ───────────────────────────────────────────────────────
  const fivemCmds = ['players','fivemjail','fivemunjail','fivemwarn','fivemkick','fivemban','fivemunban',
    'fivemannonce','fivemgiveitem','fivemsetjob','fivemteleport','fivemrevive','fivemfreeze',
    'fivemgivemoney','fivemsetcoords','fivemspectate','serverinfo'];

  if (fivemCmds.includes(cmd)) {
    if (!hasFivemPerm(interaction.member))
      return interaction.reply({ content: 'Permission insuffisante.', flags: MessageFlags.Ephemeral });
    if (!CONFIG.FIVEM_IP || !CONFIG.FIVEM_API_KEY)
      return interaction.reply({ content: 'Bridge FiveM non configuré.', flags: MessageFlags.Ephemeral });

    await interaction.reply({ content: 'Connexion au serveur FiveM...', flags: MessageFlags.Ephemeral });

    try {
      let data;

      if (cmd === 'players') {
        data = await fivemRequest('/players', 'GET');
        if (!data.success) throw new Error(data.error);
        const list = data.players.length > 0
          ? data.players.map(p => `\`[${p.id}]\` **${p.name}** — ${p.ping}ms | \`${p.license}\``).join('\n')
          : '*Aucun joueur connecté*';
        return interaction.editReply({ content: '', embeds: [fivemEmbed(`👥 Joueurs connectés (${data.count})`, list)] });
      }
      if (cmd === 'serverinfo') {
        data = await fivemRequest('/players', 'GET');
        if (!data.success) throw new Error(data.error);
        return interaction.editReply({ content: '', embeds: [fivemEmbed('🖥️ Infos Serveur HorizonPvP',
          `**Joueurs connectés :** ${data.count}\n**IP :** ${CONFIG.FIVEM_IP}:${CONFIG.FIVEM_PORT}\n**Status :** 🟢 En ligne`)] });
      }
      if (cmd === 'fivemjail') {
        const joueur = interaction.options.getString('joueur');
        const duree  = interaction.options.getInteger('duree');
        const raison = interaction.options.getString('raison') || 'Sanction administrative';
        data = await fivemRequest('/jail', 'POST', { player: joueur, duration: duree, reason: raison });
        if (!data.success) throw new Error(data.error);
        return interaction.editReply({ content: '', embeds: [fivemEmbed('🔒 Prison', `${data.message}\n\n**Raison :** ${raison}\n**Durée :** ${duree} min\n**Par :** ${interaction.user.tag}`)] });
      }
      if (cmd === 'fivemunjail') {
        data = await fivemRequest('/unjail', 'POST', { player: interaction.options.getString('joueur') });
        if (!data.success) throw new Error(data.error);
        return interaction.editReply({ content: '', embeds: [fivemEmbed('🔓 Libéré', `${data.message}\n\n**Par :** ${interaction.user.tag}`)] });
      }
      if (cmd === 'fivemwarn') {
        const joueur = interaction.options.getString('joueur');
        const raison = interaction.options.getString('raison');
        data = await fivemRequest('/warn', 'POST', { player: joueur, reason: raison });
        if (!data.success) throw new Error(data.error);
        return interaction.editReply({ content: '', embeds: [fivemEmbed('⚠️ Warn', `${data.message}\n\n**Raison :** ${raison}\n**Par :** ${interaction.user.tag}`)] });
      }
      if (cmd === 'fivemkick') {
        const joueur = interaction.options.getString('joueur');
        const raison = interaction.options.getString('raison') || 'Expulsé par un administrateur';
        data = await fivemRequest('/kick', 'POST', { player: joueur, reason: raison });
        if (!data.success) throw new Error(data.error);
        return interaction.editReply({ content: '', embeds: [fivemEmbed('👢 Kick', `${data.message}\n\n**Raison :** ${raison}\n**Par :** ${interaction.user.tag}`)] });
      }
      if (cmd === 'fivemban') {
        const joueur = interaction.options.getString('joueur');
        const raison = interaction.options.getString('raison');
        const duree  = interaction.options.getString('duree') || 'permanent';
        data = await fivemRequest('/ban', 'POST', { player: joueur, reason: raison, duration: duree });
        if (!data.success) throw new Error(data.error);
        return interaction.editReply({ content: '', embeds: [fivemEmbed('🔨 Ban', `${data.message}\n\n**License :** \`${data.license||'N/A'}\`\n**Raison :** ${raison}\n**Durée :** ${duree}\n**Par :** ${interaction.user.tag}`, false)] });
      }
      if (cmd === 'fivemunban') {
        const license = interaction.options.getString('license');
        data = await fivemRequest('/unban', 'POST', { license });
        if (!data.success) throw new Error(data.error);
        return interaction.editReply({ content: '', embeds: [fivemEmbed('✅ Unban', `${data.message}\n\n**License :** \`${license}\`\n**Par :** ${interaction.user.tag}`)] });
      }
      if (cmd === 'fivemannonce') {
        const message = interaction.options.getString('message');
        data = await fivemRequest('/announce', 'POST', { message });
        if (!data.success) throw new Error(data.error);
        return interaction.editReply({ content: '', embeds: [fivemEmbed('📢 Annonce', `**Message :** ${message}\n\n**Par :** ${interaction.user.tag}`)] });
      }
      if (cmd === 'fivemgiveitem') {
        const joueur   = interaction.options.getString('joueur');
        const item     = interaction.options.getString('item');
        const quantite = interaction.options.getInteger('quantite');
        data = await fivemRequest('/giveitem', 'POST', { player: joueur, item, count: quantite });
        if (!data.success) throw new Error(data.error);
        return interaction.editReply({ content: '', embeds: [fivemEmbed('🎁 Giveitem', `${data.message}\n\n**Item :** ${item} x${quantite}\n**Par :** ${interaction.user.tag}`)] });
      }
      if (cmd === 'fivemgivemoney') {
        const joueur  = interaction.options.getString('joueur');
        const type    = interaction.options.getString('type');
        const montant = interaction.options.getInteger('montant');
        data = await fivemRequest('/givemoney', 'POST', { player: joueur, type, amount: montant });
        if (!data.success) throw new Error(data.error);
        return interaction.editReply({ content: '', embeds: [fivemEmbed('💰 Give Money', `${data.message}\n\n**Type :** ${type}\n**Montant :** ${montant}$\n**Par :** ${interaction.user.tag}`)] });
      }
      if (cmd === 'fivemsetjob') {
        const joueur = interaction.options.getString('joueur');
        const metier = interaction.options.getString('metier');
        const grade  = interaction.options.getInteger('grade') ?? 0;
        data = await fivemRequest('/setjob', 'POST', { player: joueur, job: metier, grade });
        if (!data.success) throw new Error(data.error);
        return interaction.editReply({ content: '', embeds: [fivemEmbed('💼 Setjob', `${data.message}\n\n**Métier :** ${metier} (grade ${grade})\n**Par :** ${interaction.user.tag}`)] });
      }
      if (cmd === 'fivemteleport') {
        const joueur = interaction.options.getString('joueur');
        const x = interaction.options.getNumber('x');
        const y = interaction.options.getNumber('y');
        const z = interaction.options.getNumber('z');
        data = await fivemRequest('/teleport', 'POST', { player: joueur, x, y, z });
        if (!data.success) throw new Error(data.error);
        return interaction.editReply({ content: '', embeds: [fivemEmbed('📍 Téléport', `${data.message}\n\n**Coords :** ${x}, ${y}, ${z}\n**Par :** ${interaction.user.tag}`)] });
      }
      if (cmd === 'fivemsetcoords') {
        const joueur = interaction.options.getString('joueur');
        const lieu   = interaction.options.getString('lieu');
        const coords = {
          prison:   { x: -425.5842, y: 1123.5148, z: 325.8545 },
          hopital:  { x: 357.04,    y: -593.75,   z: 28.96    },
          mairie:   { x: -541.49,   y: -210.58,   z: 37.65    },
          aeroport: { x: -1037.0,   y: -2738.0,   z: 20.0     },
        };
        const c = coords[lieu];
        data = await fivemRequest('/teleport', 'POST', { player: joueur, x: c.x, y: c.y, z: c.z });
        if (!data.success) throw new Error(data.error);
        return interaction.editReply({ content: '', embeds: [fivemEmbed('📍 Téléport — ' + lieu, `${data.message}\n\n**Lieu :** ${lieu}\n**Par :** ${interaction.user.tag}`)] });
      }
      if (cmd === 'fivemrevive') {
        data = await fivemRequest('/revive', 'POST', { player: interaction.options.getString('joueur') });
        if (!data.success) throw new Error(data.error);
        return interaction.editReply({ content: '', embeds: [fivemEmbed('💊 Revive', `${data.message}\n\n**Par :** ${interaction.user.tag}`)] });
      }
      if (cmd === 'fivemfreeze') {
        const joueur   = interaction.options.getString('joueur');
        const action   = interaction.options.getString('action');
        const doFreeze = action === 'freeze';
        data = await fivemRequest('/freeze', 'POST', { player: joueur, freeze: doFreeze });
        if (!data.success) throw new Error(data.error);
        return interaction.editReply({ content: '', embeds: [fivemEmbed(doFreeze ? '🧊 Freeze' : '🔥 Unfreeze', `${data.message}\n\n**Par :** ${interaction.user.tag}`)] });
      }
      if (cmd === 'fivemspectate') {
        data = await fivemRequest('/spectate', 'POST', { player: interaction.options.getString('joueur') });
        if (!data.success) throw new Error(data.error);
        return interaction.editReply({ content: '', embeds: [fivemEmbed('👁️ Spectate', `${data.message}\n\n**Par :** ${interaction.user.tag}`)] });
      }

    } catch (err) {
      console.error(`Erreur FiveM (${cmd}):`, err);
      return interaction.editReply({ content: `Erreur : ${err.message}` });
    }
    return;
  }

  // ── /braksoo — IA admin ──────────────────────────────────────────────────
  if (cmd === 'braksoo') {
    if (!hasFivemPerm(interaction.member) && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild))
      return interaction.reply({ content: 'Accès refusé.', flags: MessageFlags.Ephemeral });
    if (!process.env.GROQ_API_KEY)
      return interaction.reply({ content: '❌ Clé GROQ_API_KEY manquante dans le .env', flags: MessageFlags.Ephemeral });

    const userMsg = interaction.options.getString('message');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const result = await handleAdminAI(userMsg, interaction.user.id);

      if (result.action && result.command) {
        let fivemData;
        const p = result.params || {};

        if (result.command === 'players') {
          fivemData = await fivemRequest('/players', 'GET');
        } else if (result.command === 'giveitem') {
          fivemData = await fivemRequest('/giveitem', 'POST', { player: p.player, item: p.item, count: p.count || 1 });
        } else if (result.command === 'givemoney') {
          fivemData = await fivemRequest('/givemoney', 'POST', { player: p.player, type: p.type || 'money', amount: p.amount });
        } else if (result.command === 'jail') {
          fivemData = await fivemRequest('/jail', 'POST', { player: p.player, duration: p.duration || 10, reason: p.reason || 'Sanction' });
        } else if (result.command === 'unjail') {
          fivemData = await fivemRequest('/unjail', 'POST', { player: p.player });
        } else if (result.command === 'kick') {
          fivemData = await fivemRequest('/kick', 'POST', { player: p.player, reason: p.reason || 'Kick admin' });
        } else if (result.command === 'ban') {
          fivemData = await fivemRequest('/ban', 'POST', { player: p.player, reason: p.reason || 'Ban admin', duration: p.duration || 'permanent' });
        } else if (result.command === 'warn') {
          fivemData = await fivemRequest('/warn', 'POST', { player: p.player, reason: p.reason });
        } else if (result.command === 'teleport') {
          fivemData = await fivemRequest('/teleport', 'POST', { player: p.player, x: p.x, y: p.y, z: p.z });
        } else if (result.command === 'setjob') {
          fivemData = await fivemRequest('/setjob', 'POST', { player: p.player, job: p.job, grade: p.grade || 0 });
        } else if (result.command === 'revive') {
          fivemData = await fivemRequest('/revive', 'POST', { player: p.player });
        } else if (result.command === 'freeze') {
          fivemData = await fivemRequest('/freeze', 'POST', { player: p.player, freeze: p.freeze !== false });
        } else if (result.command === 'announce') {
          fivemData = await fivemRequest('/announce', 'POST', { message: p.message });
        }

        const statusOk  = fivemData && fivemData.success;
        const statusMsg = fivemData ? (fivemData.message || fivemData.error || 'OK') : 'Réponse reçue';
        const embed = new EmbedBuilder()
          .setAuthor({ name: '🤖 Braksoo IA' })
          .setDescription(result.message + '\n\n**Résultat :** ' + (statusOk ? '✅ ' : '❌ ') + statusMsg)
          .setColor(statusOk ? 0x9B59B6 : 0xED4245)
          .setFooter({ text: 'Braksoo — HorizonPvP IA' }).setTimestamp();
        await interaction.editReply({ embeds: [embed] });
      } else {
        const embed = new EmbedBuilder()
          .setAuthor({ name: '🤖 Braksoo IA' })
          .setDescription(result.message)
          .setColor(0x9B59B6)
          .setFooter({ text: 'Braksoo — HorizonPvP IA' }).setTimestamp();
        await interaction.editReply({ embeds: [embed] });
      }
    } catch (e) {
      console.error('Erreur Braksoo IA:', e);
      await interaction.editReply({ content: '❌ Erreur IA : ' + e.message });
    }
    return;
  }

  // ── /braksooreset ─────────────────────────────────────────────────────────
  if (cmd === 'braksooreset') {
    clearHistory(interaction.user.id);
    return interaction.reply({ content: '🤖 Conversation avec Braksoo réinitialisée !', flags: MessageFlags.Ephemeral });
  }
});

client.on('error', err => console.error('Erreur client:', err));
process.on('unhandledRejection', err => console.error('Unhandled rejection:', err));

client.login(CONFIG.TOKEN);
