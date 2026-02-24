// ============================================================
// server.js — Le cerveau du jeu (côté serveur)
// Gère : connexions, parties, rôles, meurtres, votes, BOTS IA
// ============================================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ---- DONNÉES GLOBALES ----
const parties = {};

const COULEURS = [
  '#FF0000', '#0000FF', '#00FF00', '#FFFF00',
  '#FFA500', '#FF69B4', '#00FFFF', '#8B00FF',
  '#FFFFFF', '#A52A2A', '#808080', '#006400'
];

// Noms rigolos pour les bots
const NOMS_BOTS = [
  'RobotPasta', 'BotZéro', 'CyborgBleu', 'IAbob',
  'SkynetJr', 'Terminateurdu31', 'AlphaBot', 'MegaBrain',
  'Glados', 'HAL9001', 'BeepBoop', 'DataBot'
];

// Messages que les bots envoient pendant les réunions
const MESSAGES_BOTS_CREWMATE = [
  "C'était pas moi !",
  "J'étais dans le labo tout le temps...",
  "Quelqu'un m'a vu près des moteurs ?",
  "Je suis innocent je le jure !!",
  "Votez l'imposteur pas moi",
  "J'ai vu quelqu'un courir bizarrement",
  "C'est louche tout ça...",
  "Je fais confiance à personne là",
  "On devrait voter ensemble",
  "Moi j'ai rien vu du tout",
];

const MESSAGES_BOTS_IMPOSTEUR = [
  "C'est pas moi regardez ailleurs !",
  "J'accuse personne mais... réfléchissez",
  "On devrait skip ce tour",
  "J'étais avec quelqu'un je mens pas",
  "Arrêtez de voter au hasard",
  "Faites attention à qui vous faites confiance",
  "Je dis rien mais je sais qui c'est",
  "Votez skip c'est mieux",
];

const MAP_CONFIG = {
  largeur: 1200,
  hauteur: 800,
  murs: [
    { x: 0, y: 0, w: 1200, h: 20 },
    { x: 0, y: 780, w: 1200, h: 20 },
    { x: 0, y: 0, w: 20, h: 800 },
    { x: 1180, y: 0, w: 20, h: 800 },
    { x: 300, y: 20, w: 20, h: 250 },
    { x: 300, y: 350, w: 20, h: 250 },
    { x: 600, y: 20, w: 20, h: 150 },
    { x: 600, y: 250, w: 20, h: 150 },
    { x: 600, y: 500, w: 20, h: 150 },
    { x: 900, y: 20, w: 20, h: 200 },
    { x: 900, y: 350, w: 20, h: 200 },
    { x: 300, y: 380, w: 300, h: 20 },
    { x: 700, y: 380, w: 200, h: 20 },
  ]
};

// ============================================================
// FONCTIONS UTILITAIRES
// ============================================================

function genererCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function melangerTableau(tableau) {
  for (let i = tableau.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tableau[i], tableau[j]] = [tableau[j], tableau[i]];
  }
  return tableau;
}

function estProche(a, b, dist = 60) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2) < dist;
}

function toucheMur(x, y, murs, rayon = 15) {
  for (const mur of murs) {
    if (x + rayon > mur.x && x - rayon < mur.x + mur.w &&
        y + rayon > mur.y && y - rayon < mur.y + mur.h) return true;
  }
  return false;
}

function distribuerRoles(joueurs, nbImposteurs = 1) {
  const ids = melangerTableau(Object.keys(joueurs));
  ids.forEach((id, i) => {
    joueurs[id].role = i < nbImposteurs ? 'imposteur' : 'crewmate';
  });
}

function verifierVictoire(partie) {
  const vivants = Object.values(partie.joueurs).filter(j => j.vivant);
  const imposteurs = vivants.filter(j => j.role === 'imposteur');
  const crewmates = vivants.filter(j => j.role === 'crewmate');
  if (imposteurs.length === 0) return 'crewmates';
  if (imposteurs.length >= crewmates.length) return 'imposteurs';
  return null;
}

function randomEntre(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function choisirAuHasard(tableau) {
  return tableau[Math.floor(Math.random() * tableau.length)];
}

// ============================================================
// SYSTÈME DE BOTS IA
// ============================================================

// Crée un ID unique pour un bot
function genererIdBot() {
  return 'bot_' + Math.random().toString(36).slice(2, 10);
}

// Ajoute des bots jusqu'à atteindre le nombre souhaité de joueurs
function ajouterBots(code, nbTotal) {
  const partie = parties[code];
  const nbActuels = Object.keys(partie.joueurs).length;
  const nbAjouter = Math.min(nbTotal - nbActuels, 12 - nbActuels);

  const nomsUtilises = Object.values(partie.joueurs).map(j => j.pseudo);
  const nomsDispo = NOMS_BOTS.filter(n => !nomsUtilises.includes(n));

  for (let i = 0; i < nbAjouter; i++) {
    const id = genererIdBot();
    const couleursUtilisees = Object.values(partie.joueurs).map(j => j.couleur);
    const couleur = COULEURS.find(c => !couleursUtilisees.includes(c)) || COULEURS[i % COULEURS.length];
    const pseudo = nomsDispo[i] || `Bot${i + 1}`;

    partie.joueurs[id] = {
      id,
      pseudo,
      couleur,
      x: randomEntre(100, 1100),
      y: randomEntre(100, 700),
      role: null,
      vivant: true,
      estHote: false,
      estBot: true,           // ← important : c'est un bot !
      cible: null,            // cible actuelle de déplacement
      cooldownMeurtre: 0,     // temps avant de pouvoir retuer
    };

    console.log(`🤖 Bot ajouté : ${pseudo} (${id}) dans la partie ${code}`);
  }

  io.to(code).emit('mise_a_jour_lobby', { joueurs: partie.joueurs, code });
}

// Lance la boucle de comportement de tous les bots d'une partie
function lancerBouclesBots(code) {
  const partie = parties[code];

  // Chaque bot a sa propre boucle indépendante
  for (const joueur of Object.values(partie.joueurs)) {
    if (!joueur.estBot) continue;
    lancerBotIA(code, joueur.id);
  }
}

// IA d'un seul bot : tourne en boucle toutes les 500ms
function lancerBotIA(code, botId) {
  // On récupère la partie à chaque tick (elle peut avoir changé)
  const tick = setInterval(() => {
    const partie = parties[code];

    // Si la partie n'existe plus ou est terminée, on arrête le bot
    if (!partie || partie.statut === 'fin') {
      clearInterval(tick);
      return;
    }

    const bot = partie.joueurs[botId];

    // Si le bot est mort ou n'existe plus, on arrête
    if (!bot || !bot.vivant) {
      clearInterval(tick);
      return;
    }

    // Pendant le jeu → se déplacer + éventuellement tuer
    if (partie.statut === 'jeu') {
      deplacerBot(code, bot);
      if (bot.role === 'imposteur') tenterMeurtreBot(code, bot);
    }

  }, 500); // tick toutes les 500ms

  // Stocke le timer pour pouvoir l'arrêter plus tard
  const partie = parties[code];
  if (partie) {
    if (!partie.timersBot) partie.timersBot = [];
    partie.timersBot.push(tick);
  }
}

// Déplace le bot vers une destination aléatoire
function deplacerBot(code, bot) {
  const partie = parties[code];

  // Si le bot n'a pas de destination, il en choisit une
  if (!bot.cible || estProche(bot, bot.cible, 20)) {
    bot.cible = {
      x: randomEntre(50, MAP_CONFIG.largeur - 50),
      y: randomEntre(50, MAP_CONFIG.hauteur - 50)
    };
  }

  // Avance vers la cible
  const dx = bot.cible.x - bot.x;
  const dy = bot.cible.y - bot.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const vitesse = 4;

  let nx = bot.x + (dx / dist) * vitesse;
  let ny = bot.y + (dy / dist) * vitesse;

  // Évite les murs (si mur, change de destination)
  if (toucheMur(nx, ny, MAP_CONFIG.murs)) {
    bot.cible = {
      x: randomEntre(50, MAP_CONFIG.largeur - 50),
      y: randomEntre(50, MAP_CONFIG.hauteur - 50)
    };
    return;
  }

  // Limite aux bords
  nx = Math.max(25, Math.min(MAP_CONFIG.largeur - 25, nx));
  ny = Math.max(25, Math.min(MAP_CONFIG.hauteur - 25, ny));

  bot.x = nx;
  bot.y = ny;

  // Informe tous les joueurs du déplacement
  io.to(code).emit('joueur_bouge', { id: bot.id, x: bot.x, y: bot.y });
}

// Le bot imposteur essaie de tuer un crewmate proche
function tenterMeurtreBot(code, bot) {
  const partie = parties[code];

  // Cooldown entre deux meurtres (10 secondes)
  if (bot.cooldownMeurtre > Date.now()) return;

  // Cherche un crewmate vivant proche
  const cible = Object.values(partie.joueurs).find(j =>
    j.id !== bot.id &&
    j.vivant &&
    j.role === 'crewmate' &&
    estProche(bot, j, 60)
  );

  if (!cible) return;

  // Tue la cible !
  cible.vivant = false;
  bot.cooldownMeurtre = Date.now() + 10000; // 10s de cooldown

  const corps = {
    id: `corps_${Date.now()}`,
    joueurId: cible.id,
    couleur: cible.couleur,
    pseudo: cible.pseudo,
    x: cible.x,
    y: cible.y,
    signale: false
  };
  partie.corps.push(corps);

  io.to(code).emit('joueur_mort', { victimeId: cible.id, corps });
  console.log(`🤖 ${bot.pseudo} (bot imposteur) a tué ${cible.pseudo}`);

  const vainqueur = verifierVictoire(partie);
  if (vainqueur) terminerPartie(code, vainqueur);
}

// Les bots votent pendant la phase de vote
function faireVoterBots(code) {
  const partie = parties[code];
  if (!partie || partie.statut !== 'vote') return;

  // Petit délai aléatoire pour chaque bot (effet naturel)
  for (const bot of Object.values(partie.joueurs)) {
    if (!bot.estBot || !bot.vivant) continue;
    if (partie.votes[bot.id] !== undefined) continue; // a déjà voté

    const delai = randomEntre(2000, 8000); // vote entre 2 et 8 secondes
    setTimeout(() => {
      const partieActuelle = parties[code];
      if (!partieActuelle || partieActuelle.statut !== 'vote') return;
      if (partieActuelle.votes[bot.id] !== undefined) return;

      // Liste des joueurs que le bot peut voter (vivants, pas lui-même)
      const cibles = Object.values(partieActuelle.joueurs).filter(j =>
        j.vivant && j.id !== bot.id
      );

      let cibleVote;

      if (bot.role === 'imposteur') {
        // L'imposteur bot évite de voter ses complices
        const nonComplices = cibles.filter(j => j.role !== 'imposteur');
        cibleVote = nonComplices.length > 0
          ? choisirAuHasard(nonComplices).id
          : 'skip';
      } else {
        // Crewmate bot vote au hasard (50% de chance de skip)
        cibleVote = Math.random() < 0.5
          ? choisirAuHasard(cibles).id
          : 'skip';
      }

      partieActuelle.votes[bot.id] = cibleVote;

      io.to(code).emit('vote_depose', {
        voteurId: bot.id,
        nbVotes: Object.keys(partieActuelle.votes).length,
        nbJoueursVivants: Object.values(partieActuelle.joueurs).filter(j => j.vivant).length
      });

      // Vérifie si tout le monde a voté
      const joueursVivants = Object.values(partieActuelle.joueurs).filter(j => j.vivant);
      if (Object.keys(partieActuelle.votes).length >= joueursVivants.length) {
        depouiller(code);
      }

    }, delai);
  }
}

// Les bots écrivent des messages pendant la discussion
function faireEcrireBots(code) {
  const partie = parties[code];
  if (!partie) return;

  for (const bot of Object.values(partie.joueurs)) {
    if (!bot.estBot || !bot.vivant) continue;

    // Chaque bot écrit 1 à 3 messages pendant la discussion
    const nbMessages = randomEntre(1, 3);
    for (let i = 0; i < nbMessages; i++) {
      const delai = randomEntre(3000, 50000); // entre 3s et 50s
      setTimeout(() => {
        const partieActuelle = parties[code];
        if (!partieActuelle || partieActuelle.statut !== 'reunion') return;

        const messages = bot.role === 'imposteur'
          ? MESSAGES_BOTS_IMPOSTEUR
          : MESSAGES_BOTS_CREWMATE;

        const texte = choisirAuHasard(messages);

        const message = {
          pseudo: bot.pseudo,
          couleur: bot.couleur,
          texte,
          timestamp: Date.now()
        };

        partieActuelle.chat.push(message);
        io.to(code).emit('nouveau_message', message);

      }, delai);
    }
  }
}

// ============================================================
// GESTION DES CONNEXIONS SOCKET.IO
// ============================================================

io.on('connection', (socket) => {
  console.log(`Joueur connecté : ${socket.id}`);

  // ----- CRÉER UNE PARTIE -----
  socket.on('creer_partie', ({ pseudo }) => {
    let code;
    do { code = genererCode(); } while (parties[code]);

    parties[code] = {
      code,
      statut: 'lobby',
      joueurs: {},
      corps: [],
      reunionEnCours: false,
      chat: [],
      votes: {},
      minuterieReunion: null,
      timersBot: []
    };

    parties[code].joueurs[socket.id] = {
      id: socket.id,
      pseudo,
      couleur: COULEURS[0],
      x: 600, y: 400,
      role: null,
      vivant: true,
      estHote: true,
      estBot: false
    };

    socket.join(code);
    socket.data.codePartie = code;

    socket.emit('partie_creee', { code });
    io.to(code).emit('mise_a_jour_lobby', { joueurs: parties[code].joueurs, code });
    console.log(`Partie créée : ${code} par ${pseudo}`);
  });

  // ----- REJOINDRE UNE PARTIE -----
  socket.on('rejoindre_partie', ({ pseudo, code }) => {
    code = code.toUpperCase().trim();
    if (!parties[code]) { socket.emit('erreur', { message: 'Code introuvable !' }); return; }
    if (parties[code].statut !== 'lobby') { socket.emit('erreur', { message: 'Partie déjà commencée !' }); return; }
    if (Object.keys(parties[code].joueurs).length >= 12) { socket.emit('erreur', { message: 'Partie pleine !' }); return; }

    const couleursUtilisees = Object.values(parties[code].joueurs).map(j => j.couleur);
    const couleur = COULEURS.find(c => !couleursUtilisees.includes(c)) || COULEURS[0];

    parties[code].joueurs[socket.id] = {
      id: socket.id,
      pseudo,
      couleur,
      x: 600 + Math.random() * 100 - 50,
      y: 400 + Math.random() * 100 - 50,
      role: null,
      vivant: true,
      estHote: false,
      estBot: false
    };

    socket.join(code);
    socket.data.codePartie = code;
    io.to(code).emit('mise_a_jour_lobby', { joueurs: parties[code].joueurs, code });
    console.log(`${pseudo} a rejoint la partie ${code}`);
  });

  // ----- AJOUTER DES BOTS (hôte seulement) -----
  socket.on('ajouter_bots', ({ nbTotal }) => {
    const code = socket.data.codePartie;
    if (!code || !parties[code]) return;
    const joueur = parties[code].joueurs[socket.id];
    if (!joueur || !joueur.estHote) return;
    if (parties[code].statut !== 'lobby') return;

    // nbTotal = nombre total de joueurs souhaité (bots + humains)
    const nbCible = Math.min(Math.max(nbTotal, 4), 12);
    ajouterBots(code, nbCible);
  });

  // ----- RETIRER TOUS LES BOTS (hôte seulement) -----
  socket.on('retirer_bots', () => {
    const code = socket.data.codePartie;
    if (!code || !parties[code]) return;
    const joueur = parties[code].joueurs[socket.id];
    if (!joueur || !joueur.estHote) return;
    if (parties[code].statut !== 'lobby') return;

    const partie = parties[code];
    for (const id of Object.keys(partie.joueurs)) {
      if (partie.joueurs[id].estBot) delete partie.joueurs[id];
    }
    io.to(code).emit('mise_a_jour_lobby', { joueurs: partie.joueurs, code });
  });

  // ----- LANCER LA PARTIE -----
  socket.on('lancer_partie', () => {
    const code = socket.data.codePartie;
    if (!code || !parties[code]) return;
    const partie = parties[code];
    const joueur = partie.joueurs[socket.id];
    if (!joueur || !joueur.estHote) return;

    const nbJoueurs = Object.keys(partie.joueurs).length;
    if (nbJoueurs < 4) {
      socket.emit('erreur', { message: 'Il faut au moins 4 joueurs (ou bots) !' });
      return;
    }

    const nbImposteurs = nbJoueurs >= 10 ? 3 : nbJoueurs >= 7 ? 2 : 1;
    distribuerRoles(partie.joueurs, nbImposteurs);
    partie.statut = 'jeu';

    console.log(`Partie ${code} lancée : ${nbJoueurs} joueurs, ${nbImposteurs} imposteur(s)`);

    // Envoie à chaque joueur HUMAIN son rôle
    for (const [id, j] of Object.entries(partie.joueurs)) {
      if (j.estBot) continue;
      io.to(id).emit('partie_lancee', {
        monRole: j.role,
        joueurs: partie.joueurs,
        map: MAP_CONFIG,
        imposteurs: j.role === 'imposteur'
          ? Object.values(partie.joueurs).filter(x => x.role === 'imposteur').map(x => x.id)
          : []
      });
    }

    // Lance les boucles IA pour tous les bots
    lancerBouclesBots(code);
  });

  // ----- DÉPLACEMENT HUMAIN -----
  socket.on('deplacement', ({ x, y }) => {
    const code = socket.data.codePartie;
    if (!code || !parties[code]) return;
    const partie = parties[code];
    const joueur = partie.joueurs[socket.id];
    if (!joueur || !joueur.vivant || partie.statut !== 'jeu') return;

    if (!toucheMur(x, y, MAP_CONFIG.murs)) {
      if (Math.abs(x - joueur.x) < 20 && Math.abs(y - joueur.y) < 20) {
        joueur.x = x;
        joueur.y = y;
        io.to(code).emit('joueur_bouge', { id: socket.id, x, y });
      }
    }
  });

  // ----- MEURTRE (humain) -----
  socket.on('tuer', ({ cibleId }) => {
    const code = socket.data.codePartie;
    if (!code || !parties[code]) return;
    const partie = parties[code];
    const tueur = partie.joueurs[socket.id];
    const cible = partie.joueurs[cibleId];
    if (!tueur || !cible) return;
    if (tueur.role !== 'imposteur' || !tueur.vivant || !cible.vivant) return;
    if (partie.statut !== 'jeu') return;
    if (!estProche(tueur, cible)) return;

    cible.vivant = false;
    const corps = {
      id: `corps_${Date.now()}`,
      joueurId: cibleId,
      couleur: cible.couleur,
      pseudo: cible.pseudo,
      x: cible.x, y: cible.y,
      signale: false
    };
    partie.corps.push(corps);
    io.to(code).emit('joueur_mort', { victimeId: cibleId, corps });
    console.log(`${tueur.pseudo} a tué ${cible.pseudo}`);

    const vainqueur = verifierVictoire(partie);
    if (vainqueur) terminerPartie(code, vainqueur);
  });

  // ----- SIGNALER UN CORPS -----
  socket.on('signaler_corps', ({ corpsId }) => {
    const code = socket.data.codePartie;
    if (!code || !parties[code]) return;
    const partie = parties[code];
    const joueur = partie.joueurs[socket.id];
    if (!joueur || !joueur.vivant || partie.statut !== 'jeu') return;
    const corps = partie.corps.find(c => c.id === corpsId);
    if (!corps || corps.signale) return;
    if (!estProche(joueur, corps, 80)) return;
    corps.signale = true;
    lancerReunion(code, socket.id, `${joueur.pseudo} a trouvé le corps de ${corps.pseudo} !`);
  });

  // ----- URGENCE -----
  socket.on('urgence', () => {
    const code = socket.data.codePartie;
    if (!code || !parties[code]) return;
    const partie = parties[code];
    const joueur = partie.joueurs[socket.id];
    if (!joueur || !joueur.vivant || partie.statut !== 'jeu') return;
    if (!estProche(joueur, { x: 600, y: 400 }, 100)) return;
    lancerReunion(code, socket.id, `${joueur.pseudo} a appuyé sur le bouton d'urgence !`);
  });

  // ----- CHAT -----
  socket.on('message_chat', ({ texte }) => {
    const code = socket.data.codePartie;
    if (!code || !parties[code]) return;
    const partie = parties[code];
    const joueur = partie.joueurs[socket.id];
    if (!joueur || !joueur.vivant || partie.statut !== 'reunion') return;
    if (!texte.trim() || texte.length > 200) return;

    const message = { pseudo: joueur.pseudo, couleur: joueur.couleur, texte: texte.trim(), timestamp: Date.now() };
    partie.chat.push(message);
    io.to(code).emit('nouveau_message', message);
  });

  // ----- VOTER -----
  socket.on('voter', ({ cibleId }) => {
    const code = socket.data.codePartie;
    if (!code || !parties[code]) return;
    const partie = parties[code];
    const joueur = partie.joueurs[socket.id];
    if (!joueur || !joueur.vivant || partie.statut !== 'vote') return;
    if (partie.votes[socket.id] !== undefined) return;
    if (cibleId !== 'skip' && !partie.joueurs[cibleId]) return;

    partie.votes[socket.id] = cibleId;
    io.to(code).emit('vote_depose', {
      voteurId: socket.id,
      nbVotes: Object.keys(partie.votes).length,
      nbJoueursVivants: Object.values(partie.joueurs).filter(j => j.vivant).length
    });

    const vivants = Object.values(partie.joueurs).filter(j => j.vivant);
    if (Object.keys(partie.votes).length >= vivants.length) depouiller(code);
  });

  // ----- DÉCONNEXION -----
  socket.on('disconnect', () => {
    const code = socket.data.codePartie;
    if (!code || !parties[code]) return;
    const partie = parties[code];
    const joueur = partie.joueurs[socket.id];
    if (!joueur) return;

    console.log(`${joueur.pseudo} déconnecté de ${code}`);
    delete partie.joueurs[socket.id];
    io.to(code).emit('joueur_parti', { id: socket.id });

    if (partie.statut === 'jeu') {
      const v = verifierVictoire(partie);
      if (v) terminerPartie(code, v);
    }

    const humains = Object.values(partie.joueurs).filter(j => !j.estBot);
    if (humains.length === 0) {
      // Arrête tous les timers de bots
      (partie.timersBot || []).forEach(t => clearInterval(t));
      delete parties[code];
      console.log(`Partie ${code} supprimée (plus de joueurs humains)`);
    }
  });
});

// ============================================================
// FONCTIONS DE JEU
// ============================================================

function lancerReunion(code, signaleurId, raison) {
  const partie = parties[code];
  if (!partie || partie.reunionEnCours) return;

  partie.reunionEnCours = true;
  partie.statut = 'reunion';
  partie.chat = [];

  io.to(code).emit('reunion_debut', {
    signaleurId, raison,
    joueurs: partie.joueurs,
    dureeDiscussion: 60,
    dureeVote: 30
  });

  // Les bots écrivent des messages pendant la discussion
  faireEcrireBots(code);

  partie.minuterieReunion = setTimeout(() => {
    if (!parties[code]) return;
    partie.statut = 'vote';
    partie.votes = {};
    io.to(code).emit('vote_debut', { joueurs: partie.joueurs });

    // Les bots votent
    faireVoterBots(code);

    setTimeout(() => {
      if (parties[code]) depouiller(code);
    }, 30000);
  }, 60000);
}

function depouiller(code) {
  const partie = parties[code];
  if (!partie || partie.statut !== 'vote') return;

  const comptage = {};
  let skip = 0;

  for (const [, cibleId] of Object.entries(partie.votes)) {
    if (cibleId === 'skip') skip++;
    else comptage[cibleId] = (comptage[cibleId] || 0) + 1;
  }

  let maxVotes = skip, ejecte = null, egalite = false;
  for (const [id, nb] of Object.entries(comptage)) {
    if (nb > maxVotes) { maxVotes = nb; ejecte = id; egalite = false; }
    else if (nb === maxVotes && ejecte !== null) { egalite = true; ejecte = null; }
  }

  if (ejecte && partie.joueurs[ejecte]) {
    const j = partie.joueurs[ejecte];
    j.vivant = false;
    io.to(code).emit('ejection', { joueurId: ejecte, pseudo: j.pseudo, role: j.role, votes: comptage, egalite: false });
    console.log(`${j.pseudo} (${j.role}) éjecté de ${code}`);
  } else {
    io.to(code).emit('ejection', { joueurId: null, egalite: true, votes: comptage });
  }

  partie.reunionEnCours = false;

  setTimeout(() => {
    if (!parties[code]) return;
    const v = verifierVictoire(partie);
    if (v) terminerPartie(code, v);
    else {
      partie.statut = 'jeu';
      io.to(code).emit('retour_jeu', { joueurs: partie.joueurs });
    }
  }, 5000);
}

function terminerPartie(code, vainqueur) {
  const partie = parties[code];
  if (!partie) return;
  partie.statut = 'fin';

  // Arrête les timers bots
  (partie.timersBot || []).forEach(t => clearInterval(t));

  io.to(code).emit('fin_partie', { vainqueur, joueurs: partie.joueurs });
  console.log(`Partie ${code} terminée ! Victoire : ${vainqueur}`);

  setTimeout(() => { delete parties[code]; }, 30000);
}

// ---- DÉMARRAGE ----
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Serveur Among Us démarré sur http://localhost:${PORT}`);
});
