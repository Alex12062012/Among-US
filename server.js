// ============================================================
// server.js — Le cerveau du jeu (côté serveur)
// C'est lui qui gère toutes les connexions des joueurs,
// les parties, les rôles, et synchronise tout le monde.
// ============================================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// On sert les fichiers du dossier "public" (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, 'public')));

// ---- DONNÉES DU JEU ----
// On stocke toutes les parties en cours dans cet objet
const parties = {};

// Couleurs disponibles pour les joueurs
const COULEURS = [
  '#FF0000', '#0000FF', '#00FF00', '#FFFF00',
  '#FFA500', '#FF69B4', '#00FFFF', '#8B00FF',
  '#FFFFFF', '#A52A2A', '#808080', '#006400'
];

// Configuration de la map (zones et murs)
// La map fait 1200x800 pixels
const MAP_CONFIG = {
  largeur: 1200,
  hauteur: 800,
  // Les murs sont des rectangles [x, y, largeur, hauteur]
  murs: [
    // Murs extérieurs
    { x: 0, y: 0, w: 1200, h: 20 },      // mur haut
    { x: 0, y: 780, w: 1200, h: 20 },    // mur bas
    { x: 0, y: 0, w: 20, h: 800 },       // mur gauche
    { x: 1180, y: 0, w: 20, h: 800 },    // mur droit
    // Séparations intérieures (salles)
    { x: 300, y: 20, w: 20, h: 250 },    // séparation cafet/moteurs
    { x: 300, y: 350, w: 20, h: 250 },
    { x: 600, y: 20, w: 20, h: 150 },    // séparation labo
    { x: 600, y: 250, w: 20, h: 150 },
    { x: 600, y: 500, w: 20, h: 150 },
    { x: 900, y: 20, w: 20, h: 200 },    // séparation sécurité
    { x: 900, y: 350, w: 20, h: 200 },
    { x: 300, y: 380, w: 300, h: 20 },   // couloir central
    { x: 700, y: 380, w: 200, h: 20 },
  ]
};

// ---- FONCTIONS UTILITAIRES ----

// Génère un code de partie aléatoire (6 lettres majuscules)
function genererCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// Mélange un tableau (pour distribuer les rôles)
function melangerTableau(tableau) {
  for (let i = tableau.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tableau[i], tableau[j]] = [tableau[j], tableau[i]];
  }
  return tableau;
}

// Vérifie si deux joueurs sont assez proches (pour meurtre/signalement)
function estProche(joueur1, joueur2, distance = 60) {
  const dx = joueur1.x - joueur2.x;
  const dy = joueur1.y - joueur2.y;
  return Math.sqrt(dx * dx + dy * dy) < distance;
}

// Vérifie si un mouvement touche un mur
function toucheMur(x, y, murs, rayon = 15) {
  for (const mur of murs) {
    if (x + rayon > mur.x && x - rayon < mur.x + mur.w &&
        y + rayon > mur.y && y - rayon < mur.y + mur.h) {
      return true;
    }
  }
  return false;
}

// Distribue les rôles aux joueurs
function distribuerRoles(joueurs, nbImposteurs = 1) {
  const ids = Object.keys(joueurs);
  const melanges = melangerTableau([...ids]);
  
  // Les N premiers joueurs sont imposteurs
  for (let i = 0; i < ids.length; i++) {
    joueurs[ids[i]].role = i < nbImposteurs ? 'imposteur' : 'crewmate';
  }
}

// Vérifie les conditions de victoire
function verifierVictoire(partie) {
  const joueursVivants = Object.values(partie.joueurs).filter(j => j.vivant);
  const imposteurs = joueursVivants.filter(j => j.role === 'imposteur');
  const crewmates = joueursVivants.filter(j => j.role === 'crewmate');
  
  // Les imposteurs gagnent s'ils sont autant ou plus que les crewmates
  if (imposteurs.length >= crewmates.length && imposteurs.length > 0) {
    return 'imposteurs';
  }
  
  // Les crewmates gagnent s'il n'y a plus d'imposteurs
  if (imposteurs.length === 0) {
    return 'crewmates';
  }
  
  return null; // Partie en cours
}

// ---- GESTION DES CONNEXIONS SOCKET.IO ----
io.on('connection', (socket) => {
  console.log(`Joueur connecté : ${socket.id}`);

  // ----- CRÉER UNE PARTIE -----
  socket.on('creer_partie', ({ pseudo }) => {
    let code;
    // S'assure que le code est unique
    do { code = genererCode(); } while (parties[code]);
    
    parties[code] = {
      code,
      statut: 'lobby',    // lobby, jeu, reunion, fin
      joueurs: {},
      corps: [],          // corps sur la map
      reunionEnCours: false,
      chat: [],
      votes: {},
      minuterieReunion: null
    };
    
    // Le créateur rejoint automatiquement
    const couleurIndex = 0;
    parties[code].joueurs[socket.id] = {
      id: socket.id,
      pseudo,
      couleur: COULEURS[couleurIndex],
      x: 600, y: 400,     // position de départ (centre)
      role: null,
      vivant: true,
      estHote: true
    };
    
    socket.join(code);
    socket.data.codePartie = code;
    
    // Envoie la confirmation au créateur
    socket.emit('partie_creee', { code });
    io.to(code).emit('mise_a_jour_lobby', { joueurs: parties[code].joueurs, code });
    
    console.log(`Partie créée : ${code} par ${pseudo}`);
  });

  // ----- REJOINDRE UNE PARTIE -----
  socket.on('rejoindre_partie', ({ pseudo, code }) => {
    code = code.toUpperCase().trim();
    
    // Vérifications
    if (!parties[code]) {
      socket.emit('erreur', { message: 'Code de partie introuvable !' });
      return;
    }
    if (parties[code].statut !== 'lobby') {
      socket.emit('erreur', { message: 'La partie a déjà commencé !' });
      return;
    }
    if (Object.keys(parties[code].joueurs).length >= 12) {
      socket.emit('erreur', { message: 'La partie est pleine (12 joueurs max) !' });
      return;
    }
    
    // Attribue une couleur unique
    const couleursUtilisees = Object.values(parties[code].joueurs).map(j => j.couleur);
    const couleurDispo = COULEURS.find(c => !couleursUtilisees.includes(c)) || COULEURS[0];
    
    parties[code].joueurs[socket.id] = {
      id: socket.id,
      pseudo,
      couleur: couleurDispo,
      x: 600 + Math.random() * 100 - 50,
      y: 400 + Math.random() * 100 - 50,
      role: null,
      vivant: true,
      estHote: false
    };
    
    socket.join(code);
    socket.data.codePartie = code;
    
    io.to(code).emit('mise_a_jour_lobby', { joueurs: parties[code].joueurs, code });
    console.log(`${pseudo} a rejoint la partie ${code}`);
  });

  // ----- LANCER LA PARTIE (hôte seulement) -----
  socket.on('lancer_partie', () => {
    const code = socket.data.codePartie;
    if (!code || !parties[code]) return;
    
    const partie = parties[code];
    const joueur = partie.joueurs[socket.id];
    
    // Seul l'hôte peut lancer
    if (!joueur || !joueur.estHote) return;
    
    const nbJoueurs = Object.keys(partie.joueurs).length;
    if (nbJoueurs < 4) {
      socket.emit('erreur', { message: 'Il faut au moins 4 joueurs pour commencer !' });
      return;
    }
    
    // Détermine le nombre d'imposteurs selon le nombre de joueurs
    const nbImposteurs = nbJoueurs >= 10 ? 3 : nbJoueurs >= 7 ? 2 : 1;
    
    // Distribue les rôles
    distribuerRoles(partie.joueurs, nbImposteurs);
    partie.statut = 'jeu';
    
    console.log(`Partie ${code} lancée avec ${nbJoueurs} joueurs, ${nbImposteurs} imposteur(s)`);
    
    // Envoie à chaque joueur son propre rôle (en privé !)
    for (const [id, joueur] of Object.entries(partie.joueurs)) {
      io.to(id).emit('partie_lancee', {
        monRole: joueur.role,
        joueurs: partie.joueurs,
        map: MAP_CONFIG,
        // Si imposteur, on lui donne la liste des autres imposteurs
        imposteurs: joueur.role === 'imposteur'
          ? Object.values(partie.joueurs).filter(j => j.role === 'imposteur').map(j => j.id)
          : []
      });
    }
  });

  // ----- DÉPLACEMENT D'UN JOUEUR -----
  socket.on('deplacement', ({ x, y }) => {
    const code = socket.data.codePartie;
    if (!code || !parties[code]) return;
    
    const partie = parties[code];
    const joueur = partie.joueurs[socket.id];
    
    if (!joueur || !joueur.vivant || partie.statut !== 'jeu') return;
    
    // Vérifie que la nouvelle position ne traverse pas un mur
    if (!toucheMur(x, y, MAP_CONFIG.murs)) {
      // Vérifie que le joueur ne se téléporte pas (anti-triche basique)
      const dx = Math.abs(x - joueur.x);
      const dy = Math.abs(y - joueur.y);
      if (dx < 20 && dy < 20) {
        joueur.x = x;
        joueur.y = y;
        
        // Envoie la position à TOUS les joueurs de la partie
        io.to(code).emit('joueur_bouge', {
          id: socket.id,
          x: joueur.x,
          y: joueur.y
        });
      }
    }
  });

  // ----- MEURTRE -----
  socket.on('tuer', ({ cibleId }) => {
    const code = socket.data.codePartie;
    if (!code || !parties[code]) return;
    
    const partie = parties[code];
    const tueur = partie.joueurs[socket.id];
    const cible = partie.joueurs[cibleId];
    
    // Vérifications de sécurité
    if (!tueur || !cible) return;
    if (tueur.role !== 'imposteur') return;
    if (!tueur.vivant || !cible.vivant) return;
    if (partie.statut !== 'jeu') return;
    if (!estProche(tueur, cible)) return;
    
    // Le meurtre est validé !
    cible.vivant = false;
    
    // Crée un corps à cet endroit
    const corps = {
      id: `corps_${Date.now()}`,
      joueurId: cibleId,
      couleur: cible.couleur,
      pseudo: cible.pseudo,
      x: cible.x,
      y: cible.y,
      signale: false
    };
    partie.corps.push(corps);
    
    // Informe tous les joueurs
    io.to(code).emit('joueur_mort', {
      victimeId: cibleId,
      corps: corps
    });
    
    console.log(`${tueur.pseudo} a tué ${cible.pseudo} dans la partie ${code}`);
    
    // Vérifie la victoire
    const vainqueur = verifierVictoire(partie);
    if (vainqueur) {
      terminerPartie(code, vainqueur);
    }
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
    
    // Vérifie que le joueur est proche du corps
    if (!estProche(joueur, corps, 80)) return;
    
    corps.signale = true;
    
    console.log(`${joueur.pseudo} a signalé le corps de ${corps.pseudo}`);
    
    // Lance une réunion
    lancerReunion(code, socket.id, `${joueur.pseudo} a trouvé le corps de ${corps.pseudo} !`);
  });

  // ----- BOUTON D'URGENCE -----
  socket.on('urgence', () => {
    const code = socket.data.codePartie;
    if (!code || !parties[code]) return;
    
    const partie = parties[code];
    const joueur = partie.joueurs[socket.id];
    
    if (!joueur || !joueur.vivant || partie.statut !== 'jeu') return;
    
    // Vérifie que le joueur est proche du bouton d'urgence (centre de la cafétéria)
    const bouton = { x: 600, y: 400 };
    if (!estProche(joueur, bouton, 100)) return;
    
    lancerReunion(code, socket.id, `${joueur.pseudo} a appuyé sur le bouton d'urgence !`);
  });

  // ----- MESSAGE DE CHAT (pendant réunion) -----
  socket.on('message_chat', ({ texte }) => {
    const code = socket.data.codePartie;
    if (!code || !parties[code]) return;
    
    const partie = parties[code];
    const joueur = partie.joueurs[socket.id];
    
    // Seuls les joueurs vivants peuvent écrire
    if (!joueur || !joueur.vivant) return;
    if (partie.statut !== 'reunion') return;
    if (texte.trim().length === 0 || texte.length > 200) return;
    
    const message = {
      pseudo: joueur.pseudo,
      couleur: joueur.couleur,
      texte: texte.trim(),
      timestamp: Date.now()
    };
    
    partie.chat.push(message);
    io.to(code).emit('nouveau_message', message);
  });

  // ----- VOTER -----
  socket.on('voter', ({ cibleId }) => {
    const code = socket.data.codePartie;
    if (!code || !parties[code]) return;
    
    const partie = parties[code];
    const joueur = partie.joueurs[socket.id];
    
    if (!joueur || !joueur.vivant) return;
    if (partie.statut !== 'vote') return;
    if (partie.votes[socket.id] !== undefined) return; // a déjà voté
    
    // cibleId peut être 'skip' pour passer
    if (cibleId !== 'skip' && !partie.joueurs[cibleId]) return;
    
    partie.votes[socket.id] = cibleId;
    
    // Informe tout le monde qu'un vote a été déposé (sans révéler pour qui)
    io.to(code).emit('vote_depose', {
      voteurId: socket.id,
      nbVotes: Object.keys(partie.votes).length,
      nbJoueursVivants: Object.values(partie.joueurs).filter(j => j.vivant).length
    });
    
    // Si tout le monde a voté, on dépouille
    const joueursVivants = Object.values(partie.joueurs).filter(j => j.vivant);
    if (Object.keys(partie.votes).length >= joueursVivants.length) {
      depouiller(code);
    }
  });

  // ----- DÉCONNEXION -----
  socket.on('disconnect', () => {
    const code = socket.data.codePartie;
    if (!code || !parties[code]) return;
    
    const partie = parties[code];
    const joueur = partie.joueurs[socket.id];
    
    if (joueur) {
      console.log(`${joueur.pseudo} s'est déconnecté de la partie ${code}`);
      delete partie.joueurs[socket.id];
      
      // Informe les autres
      io.to(code).emit('joueur_parti', { id: socket.id });
      
      // Si la partie est en cours, vérifie la victoire
      if (partie.statut === 'jeu') {
        const vainqueur = verifierVictoire(partie);
        if (vainqueur) terminerPartie(code, vainqueur);
      }
      
      // Si plus personne, supprime la partie
      if (Object.keys(partie.joueurs).length === 0) {
        delete parties[code];
        console.log(`Partie ${code} supprimée (vide)`);
      }
    }
  });
});

// ---- FONCTIONS DE JEU ----

function lancerReunion(code, signaleurId, raison) {
  const partie = parties[code];
  if (partie.reunionEnCours) return;
  
  partie.reunionEnCours = true;
  partie.statut = 'reunion';
  partie.chat = [];
  
  // Phase 1 : discussion (60 secondes)
  io.to(code).emit('reunion_debut', {
    signaleurId,
    raison,
    joueurs: partie.joueurs,
    dureeDiscussion: 60,
    dureeVote: 30
  });
  
  // Après 60 secondes, on passe au vote
  partie.minuterieReunion = setTimeout(() => {
    partie.statut = 'vote';
    partie.votes = {};
    io.to(code).emit('vote_debut', { joueurs: partie.joueurs });
    
    // Après 30 secondes de vote, on dépouille automatiquement
    setTimeout(() => {
      depouiller(code);
    }, 30000);
    
  }, 60000);
}

function depouiller(code) {
  const partie = parties[code];
  if (partie.statut !== 'vote') return;
  
  // Compte les votes
  const comptage = {};
  let skip = 0;
  
  for (const [voteurId, cibleId] of Object.entries(partie.votes)) {
    if (cibleId === 'skip') {
      skip++;
    } else {
      comptage[cibleId] = (comptage[cibleId] || 0) + 1;
    }
  }
  
  // Trouve le joueur le plus voté
  let maxVotes = skip;
  let ejecte = null;
  let egalite = false;
  
  for (const [id, nb] of Object.entries(comptage)) {
    if (nb > maxVotes) {
      maxVotes = nb;
      ejecte = id;
      egalite = false;
    } else if (nb === maxVotes) {
      egalite = true;
      ejecte = null;
    }
  }
  
  // Éjecte le joueur (si pas d'égalité)
  if (ejecte && partie.joueurs[ejecte]) {
    const joueurEjecte = partie.joueurs[ejecte];
    joueurEjecte.vivant = false;
    
    io.to(code).emit('ejection', {
      joueurId: ejecte,
      pseudo: joueurEjecte.pseudo,
      role: joueurEjecte.role, // On révèle le rôle !
      votes: comptage,
      egalite: false
    });
    
    console.log(`${joueurEjecte.pseudo} (${joueurEjecte.role}) éjecté de la partie ${code}`);
  } else {
    io.to(code).emit('ejection', {
      joueurId: null,
      egalite: true,
      votes: comptage
    });
  }
  
  // Remet la partie en jeu après 5 secondes
  partie.reunionEnCours = false;
  
  setTimeout(() => {
    const vainqueur = verifierVictoire(partie);
    if (vainqueur) {
      terminerPartie(code, vainqueur);
    } else {
      partie.statut = 'jeu';
      io.to(code).emit('retour_jeu', { joueurs: partie.joueurs });
    }
  }, 5000);
}

function terminerPartie(code, vainqueur) {
  const partie = parties[code];
  partie.statut = 'fin';
  
  io.to(code).emit('fin_partie', {
    vainqueur, // 'crewmates' ou 'imposteurs'
    joueurs: partie.joueurs // Révèle tous les rôles
  });
  
  console.log(`Partie ${code} terminée ! Victoire : ${vainqueur}`);
  
  // Supprime la partie après 30 secondes
  setTimeout(() => {
    delete parties[code];
  }, 30000);
}

// ---- DÉMARRAGE DU SERVEUR ----
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Serveur Among Us démarré sur http://localhost:${PORT}`);
});
