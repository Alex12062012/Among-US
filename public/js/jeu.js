// ============================================================
// jeu.js — Le code du jeu côté client (navigateur)
// Ce fichier gère : le canvas, les déplacements, l'affichage,
// la communication avec le serveur, et toute l'interface.
// ============================================================

// ---- CONNEXION AU SERVEUR ----
// Socket.io permet la communication en temps réel avec le serveur
const socket = io();

// ---- ÉTAT DU JEU (toutes les données importantes) ----
const etat = {
  // Infos du joueur local
  monId: null,
  monRole: null,
  monPseudo: null,
  
  // Données de la partie
  codePartie: null,
  joueurs: {},       // tous les joueurs (positions, rôles, etc.)
  corps: [],         // corps sur la map
  imposteurs: [],    // IDs des imposteurs (visible seulement pour les imposteurs)
  
  // Map et mouvement
  mapConfig: null,
  vitesse: 3,        // pixels par frame
  touches: {         // état des touches du clavier
    haut: false,
    bas: false,
    gauche: false,
    droite: false
  },
  
  // Canvas
  canvas: null,
  ctx: null,
  cameraX: 0,        // décalage de la caméra (suit le joueur)
  cameraY: 0,
  
  // Réunion
  minuterieReunion: null,
  minuterieVote: null,
  aVote: false
};

// ---- RÉFÉRENCES AUX ÉLÉMENTS HTML ----
const ecrans = {
  accueil: document.getElementById('ecran-accueil'),
  lobby: document.getElementById('ecran-lobby'),
  jeu: document.getElementById('ecran-jeu'),
  reunion: document.getElementById('ecran-reunion'),
  fin: document.getElementById('ecran-fin')
};

// ============================================================
// FONCTIONS D'AFFICHAGE (montrer/cacher les écrans)
// ============================================================

function afficherEcran(nom) {
  // Cache tous les écrans
  Object.values(ecrans).forEach(e => {
    e.classList.remove('actif');
    e.style.display = 'none';
  });
  
  // Affiche le bon écran
  const ecran = ecrans[nom];
  ecran.style.display = 'flex';
  ecran.classList.add('actif');
}

function afficherErreur(message) {
  const elem = document.getElementById('message-erreur');
  elem.textContent = message;
  elem.classList.remove('hidden');
  setTimeout(() => elem.classList.add('hidden'), 4000);
}

// ============================================================
// LOBBY — Interface de la salle d'attente
// ============================================================

function mettreAJourLobby(joueurs, code) {
  const liste = document.getElementById('liste-joueurs-lobby');
  liste.innerHTML = '';
  
  for (const joueur of Object.values(joueurs)) {
    const carte = document.createElement('div');
    carte.className = 'joueur-carte';
    
    carte.innerHTML = `
      <div class="joueur-astronaute" style="background:${joueur.couleur}"></div>
      <div class="joueur-pseudo">${joueur.pseudo}</div>
      ${joueur.estHote ? '<div class="joueur-hote-badge">⭐ Hôte</div>' : ''}
    `;
    
    liste.appendChild(carte);
  }
}

// ============================================================
// CANVAS ET DESSIN DU JEU
// ============================================================

function initialiserCanvas() {
  etat.canvas = document.getElementById('canvas-jeu');
  etat.ctx = etat.canvas.getContext('2d');
  
  // Adapte le canvas à la taille de la fenêtre
  redimensionnerCanvas();
  window.addEventListener('resize', redimensionnerCanvas);
  
  // Lance la boucle de jeu (60 fps)
  requestAnimationFrame(boucleJeu);
}

function redimensionnerCanvas() {
  etat.canvas.width = window.innerWidth;
  etat.canvas.height = window.innerHeight;
}

// La boucle de jeu : mouvement + dessin, appelée 60 fois par seconde
function boucleJeu() {
  if (ecrans.jeu.classList.contains('actif')) {
    mettreAJourMouvement();
    dessiner();
  }
  requestAnimationFrame(boucleJeu);
}

// Met à jour la position du joueur selon les touches pressées
function mettreAJourMouvement() {
  const moi = etat.joueurs[etat.monId];
  if (!moi || !moi.vivant) return;
  
  let dx = 0, dy = 0;
  
  if (etat.touches.haut)    dy -= etat.vitesse;
  if (etat.touches.bas)     dy += etat.vitesse;
  if (etat.touches.gauche)  dx -= etat.vitesse;
  if (etat.touches.droite)  dx += etat.vitesse;
  
  // Normalise le mouvement en diagonal (évite d'aller plus vite en diagonal)
  if (dx !== 0 && dy !== 0) {
    dx *= 0.707; // = 1 / √2
    dy *= 0.707;
  }
  
  if (dx === 0 && dy === 0) return;
  
  // Calcule la nouvelle position
  let nx = moi.x + dx;
  let ny = moi.y + dy;
  
  // Limite aux bords de la map
  nx = Math.max(20, Math.min(etat.mapConfig.largeur - 20, nx));
  ny = Math.max(20, Math.min(etat.mapConfig.hauteur - 20, ny));
  
  // Vérifie les collisions avec les murs
  if (!toucheMurClient(nx, ny)) {
    moi.x = nx;
    moi.y = ny;
    
    // Envoie la position au serveur
    socket.emit('deplacement', { x: moi.x, y: moi.y });
  }
  
  // Met à jour la caméra pour suivre le joueur
  mettreAJourCamera();
  
  // Vérifie si des actions sont disponibles
  verifierActionsProximite();
}

// La caméra suit le joueur (effet de scrolling)
function mettreAJourCamera() {
  const moi = etat.joueurs[etat.monId];
  if (!moi) return;
  
  const cibleX = moi.x - etat.canvas.width / 2;
  const cibleY = moi.y - etat.canvas.height / 2;
  
  // Limite la caméra aux bords de la map
  etat.cameraX = Math.max(0, Math.min(etat.mapConfig.largeur - etat.canvas.width, cibleX));
  etat.cameraY = Math.max(0, Math.min(etat.mapConfig.hauteur - etat.canvas.height, cibleY));
  
  // Si la map est plus petite que l'écran, on centre
  if (etat.mapConfig.largeur < etat.canvas.width) {
    etat.cameraX = (etat.mapConfig.largeur - etat.canvas.width) / 2;
  }
  if (etat.mapConfig.hauteur < etat.canvas.height) {
    etat.cameraY = (etat.mapConfig.hauteur - etat.canvas.height) / 2;
  }
}

// Vérifie les collisions côté client (même logique que le serveur)
function toucheMurClient(x, y, rayon = 15) {
  if (!etat.mapConfig) return false;
  for (const mur of etat.mapConfig.murs) {
    if (x + rayon > mur.x && x - rayon < mur.x + mur.w &&
        y + rayon > mur.y && y - rayon < mur.y + mur.h) {
      return true;
    }
  }
  return false;
}

// ---- DESSIN ----

function dessiner() {
  const ctx = etat.ctx;
  const W = etat.canvas.width;
  const H = etat.canvas.height;
  
  // Efface le canvas
  ctx.fillStyle = '#0a0e1a';
  ctx.fillRect(0, 0, W, H);
  
  if (!etat.mapConfig) return;
  
  // Applique la caméra (décalage)
  ctx.save();
  ctx.translate(-etat.cameraX, -etat.cameraY);
  
  // Dessine la map
  dessinerMap(ctx);
  
  // Dessine les corps
  for (const corps of etat.corps) {
    dessinerCorps(ctx, corps);
  }
  
  // Dessine les joueurs
  for (const joueur of Object.values(etat.joueurs)) {
    if (joueur.vivant) {
      dessinerJoueur(ctx, joueur, joueur.id === etat.monId);
    }
  }
  
  ctx.restore();
}

function dessinerMap(ctx) {
  const map = etat.mapConfig;
  
  // Fond de la map
  ctx.fillStyle = '#141c2e';
  ctx.fillRect(0, 0, map.largeur, map.hauteur);
  
  // Grille de sol (effet visuel)
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for (let x = 0; x < map.largeur; x += 60) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, map.hauteur);
    ctx.stroke();
  }
  for (let y = 0; y < map.hauteur; y += 60) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(map.largeur, y);
    ctx.stroke();
  }
  
  // Étiquettes des salles
  const salles = [
    { nom: 'CAFÉTÉRIA', x: 600, y: 400 },
    { nom: 'MOTEURS', x: 150, y: 200 },
    { nom: 'LABORATOIRE', x: 750, y: 200 },
    { nom: 'SÉCURITÉ', x: 1050, y: 200 },
    { nom: 'COULOIR', x: 450, y: 500 },
  ];
  
  ctx.font = 'bold 12px "Orbitron", monospace';
  ctx.textAlign = 'center';
  
  for (const salle of salles) {
    ctx.fillStyle = 'rgba(79, 195, 247, 0.2)';
    ctx.fillText(salle.nom, salle.x, salle.y - 30);
  }
  
  // Bouton d'urgence (cafétéria)
  ctx.fillStyle = '#ff4444';
  ctx.beginPath();
  ctx.arc(600, 400, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#cc0000';
  ctx.beginPath();
  ctx.arc(600, 400, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'white';
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('URG', 600, 403);
  
  // Dessine les murs
  ctx.fillStyle = '#0d1b2a';
  for (const mur of map.murs) {
    ctx.fillRect(mur.x, mur.y, mur.w, mur.h);
    // Contour lumineux des murs
    ctx.strokeStyle = 'rgba(79, 195, 247, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mur.x, mur.y, mur.w, mur.h);
  }
}

// Dessine un personnage (astronaute stylisé)
function dessinerJoueur(ctx, joueur, estMoi) {
  const x = joueur.x;
  const y = joueur.y;
  const r = 16; // rayon du corps
  
  // Ombre
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(x, y + r + 4, r, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Corps de l'astronaute (forme arrondie)
  ctx.fillStyle = joueur.couleur;
  ctx.beginPath();
  ctx.ellipse(x, y, r * 0.8, r, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Jambes
  ctx.fillStyle = joueur.couleur;
  ctx.fillRect(x - r * 0.7, y + r * 0.4, r * 0.55, r * 0.8);
  ctx.fillRect(x + r * 0.15, y + r * 0.4, r * 0.55, r * 0.8);
  
  // Sac à dos (détail)
  ctx.fillStyle = ajusterCouleur(joueur.couleur, -30);
  ctx.fillRect(x - r * 0.9, y - r * 0.3, r * 0.3, r * 0.6);
  
  // Visière du casque
  ctx.fillStyle = 'rgba(100, 200, 255, 0.7)';
  ctx.beginPath();
  ctx.ellipse(x + r * 0.15, y - r * 0.1, r * 0.5, r * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Reflet sur la visière
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.ellipse(x + r * 0.05, y - r * 0.2, r * 0.15, r * 0.1, -0.5, 0, Math.PI * 2);
  ctx.fill();
  
  // Contour si c'est notre joueur
  if (estMoi) {
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.8 + 3, r + 3, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  
  // Pseudo au-dessus
  ctx.fillStyle = 'white';
  ctx.font = 'bold 10px "Orbitron", monospace';
  ctx.textAlign = 'center';
  ctx.shadowColor = 'black';
  ctx.shadowBlur = 4;
  ctx.fillText(joueur.pseudo, x, y - r - 8);
  ctx.shadowBlur = 0;
  
  // Indicateur imposteur (visible uniquement par les imposteurs)
  if (etat.imposteurs.includes(joueur.id) && joueur.id !== etat.monId) {
    ctx.fillStyle = 'rgba(255, 68, 68, 0.8)';
    ctx.font = 'bold 8px monospace';
    ctx.fillText('[IMP]', x, y - r - 18);
  }
}

// Dessine un corps (joueur mort)
function dessinerCorps(ctx, corps) {
  const x = corps.x;
  const y = corps.y;
  
  // Corps allongé
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 3); // couché sur le côté
  
  ctx.fillStyle = corps.couleur;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.ellipse(0, 0, 20, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  
  ctx.restore();
  ctx.globalAlpha = 1;
  
  // Symbole de mort
  ctx.fillStyle = 'rgba(255, 68, 68, 0.9)';
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('☠', x, y - 15);
  
  // Nom
  ctx.fillStyle = 'rgba(255,100,100,0.8)';
  ctx.font = '9px "Orbitron", monospace';
  ctx.fillText(corps.pseudo, x, y - 28);
}

// Éclaircit ou assombrit une couleur hex
function ajusterCouleur(hex, montant) {
  let r = parseInt(hex.slice(1, 3), 16);
  let g = parseInt(hex.slice(3, 5), 16);
  let b = parseInt(hex.slice(5, 7), 16);
  r = Math.max(0, Math.min(255, r + montant));
  g = Math.max(0, Math.min(255, g + montant));
  b = Math.max(0, Math.min(255, b + montant));
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

// ============================================================
// ACTIONS EN JEU (tuer, signaler, urgence)
// ============================================================

function distance(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function verifierActionsProximite() {
  const moi = etat.joueurs[etat.monId];
  if (!moi || !moi.vivant) return;
  
  // Bouton tuer (imposteurs seulement)
  const btnTuer = document.getElementById('btn-tuer');
  if (etat.monRole === 'imposteur') {
    const cibleProche = Object.values(etat.joueurs).find(j =>
      j.id !== etat.monId && j.vivant && j.role !== 'imposteur' && distance(moi, j) < 60
    );
    
    if (cibleProche) {
      btnTuer.classList.remove('hidden');
      btnTuer.dataset.cible = cibleProche.id;
    } else {
      btnTuer.classList.add('hidden');
    }
  }
  
  // Bouton signaler un corps
  const btnSignaler = document.getElementById('btn-signaler');
  const corpsProche = etat.corps.find(c => !c.signale && distance(moi, c) < 80);
  if (corpsProche) {
    btnSignaler.classList.remove('hidden');
    btnSignaler.dataset.corps = corpsProche.id;
  } else {
    btnSignaler.classList.add('hidden');
  }
  
  // Bouton urgence (proche du centre cafétéria)
  const btnUrgence = document.getElementById('btn-urgence');
  if (distance(moi, { x: 600, y: 400 }) < 100) {
    btnUrgence.classList.remove('hidden');
  } else {
    btnUrgence.classList.add('hidden');
  }
}

// ============================================================
// RÉUNION
// ============================================================

function afficherReunion(data) {
  // Remplit la liste des joueurs pour voter
  const listeVotes = document.getElementById('liste-votes');
  listeVotes.innerHTML = '';
  
  for (const joueur of Object.values(data.joueurs)) {
    const item = document.createElement('div');
    item.className = `vote-joueur-item ${joueur.vivant ? '' : 'vote-mort'}`;
    item.innerHTML = `
      <div class="vote-dot" style="background:${joueur.couleur}"></div>
      <span class="vote-pseudo">${joueur.pseudo}</span>
    `;
    listeVotes.appendChild(item);
  }
  
  document.getElementById('reunion-raison').textContent = data.raison;
  document.getElementById('messages-chat').innerHTML = '';
  
  // Lance la minuterie de discussion (60 secondes)
  let secondes = data.dureeDiscussion;
  const minuterieElem = document.getElementById('minuterie-texte');
  minuterieElem.textContent = secondes;
  
  etat.minuterieReunion = setInterval(() => {
    secondes--;
    minuterieElem.textContent = secondes;
    if (secondes <= 0) clearInterval(etat.minuterieReunion);
  }, 1000);
  
  afficherEcran('reunion');
}

function afficherPhaseVote(joueurs) {
  clearInterval(etat.minuterieReunion);
  etat.aVote = false;
  
  // Affiche la zone de vote
  document.getElementById('zone-vote').classList.remove('hidden');
  document.getElementById('chat-input-zone').classList.add('hidden');
  document.getElementById('minuterie-container').innerHTML =
    'Vote : <span id="minuterie-vote" class="minuterie">30</span>s';
  
  // Crée les boutons de vote
  const zone = document.getElementById('joueurs-a-voter');
  zone.innerHTML = '';
  
  for (const joueur of Object.values(joueurs)) {
    if (!joueur.vivant || joueur.id === etat.monId) continue;
    
    const btn = document.createElement('button');
    btn.className = 'btn-vote-joueur';
    btn.dataset.id = joueur.id;
    btn.innerHTML = `
      <span style="width:10px;height:10px;border-radius:50%;background:${joueur.couleur};display:inline-block"></span>
      ${joueur.pseudo}
    `;
    btn.addEventListener('click', () => voter(joueur.id));
    zone.appendChild(btn);
  }
  
  // Minuterie de vote
  let secondes = 30;
  const minuterieVote = document.getElementById('minuterie-vote');
  if (minuterieVote) minuterieVote.textContent = secondes;
  
  etat.minuterieVote = setInterval(() => {
    secondes--;
    const elem = document.getElementById('minuterie-vote');
    if (elem) elem.textContent = secondes;
    if (secondes <= 0) clearInterval(etat.minuterieVote);
  }, 1000);
}

function voter(cibleId) {
  if (etat.aVote) return;
  etat.aVote = true;
  
  // Visual feedback
  document.querySelectorAll('.btn-vote-joueur').forEach(btn => {
    if (btn.dataset.id === cibleId) btn.classList.add('vote-selectionne');
    btn.disabled = true;
  });
  
  socket.emit('voter', { cibleId });
}

// ============================================================
// FIN DE PARTIE
// ============================================================

function afficherFinPartie(data) {
  const estVainqueur = (data.vainqueur === 'crewmates' && etat.monRole === 'crewmate') ||
                       (data.vainqueur === 'imposteurs' && etat.monRole === 'imposteur');
  
  const titreFin = document.getElementById('fin-titre');
  const resultFin = document.getElementById('fin-resultat');
  
  if (data.vainqueur === 'crewmates') {
    titreFin.textContent = 'CREWMATES GAGNENT !';
    titreFin.style.color = '#44ff88';
    resultFin.textContent = 'Tous les imposteurs ont été démasqués 🎉';
  } else {
    titreFin.textContent = 'IMPOSTEURS GAGNENT !';
    titreFin.style.color = '#ff4444';
    resultFin.textContent = 'Les imposteurs ont semé la terreur 👾';
  }
  
  // Affiche tous les joueurs avec leur rôle révélé
  const liste = document.getElementById('fin-joueurs');
  liste.innerHTML = '';
  for (const joueur of Object.values(data.joueurs)) {
    const item = document.createElement('div');
    item.className = 'fin-joueur-item';
    const emoji = joueur.role === 'imposteur' ? '👾' : '🧑‍🚀';
    item.innerHTML = `
      <span style="width:12px;height:12px;border-radius:50%;background:${joueur.couleur};display:inline-block"></span>
      ${joueur.pseudo} ${emoji} ${joueur.role.toUpperCase()}
    `;
    liste.appendChild(item);
  }
  
  afficherEcran('fin');
}

// ============================================================
// ÉVÉNEMENTS SOCKET.IO (réponses du serveur)
// ============================================================

// Connexion établie
socket.on('connect', () => {
  etat.monId = socket.id;
});

// Erreur du serveur
socket.on('erreur', ({ message }) => {
  afficherErreur(message);
});

// Partie créée → mise_a_jour_lobby arrive juste après et gère l'affichage
socket.on('partie_creee', ({ code }) => {
  etat.codePartie = code;
  console.log('🎮 Partie créée :', code);
});

// (mise_a_jour_lobby géré plus bas, une seule fois)

// La partie commence !
socket.on('partie_lancee', ({ monRole, joueurs, map, imposteurs }) => {
  etat.monRole = monRole;
  etat.joueurs = joueurs;
  etat.mapConfig = map;
  etat.imposteurs = imposteurs;
  etat.corps = [];
  
  // Affiche le rôle dans le HUD
  const texteRole = document.getElementById('texte-role');
  if (monRole === 'imposteur') {
    texteRole.textContent = '👾 IMPOSTEUR';
    texteRole.style.color = '#ff4444';
    document.getElementById('btn-tuer').classList.remove('hidden');
  } else {
    texteRole.textContent = '🧑‍🚀 CREWMATE';
    texteRole.style.color = '#44ff88';
  }
  
  afficherEcran('jeu');
  initialiserCanvas();
  
  // Annonce du rôle
  setTimeout(() => {
    alert(`Tu es : ${monRole.toUpperCase()} !\n${monRole === 'imposteur' ? '😈 Élimine les crewmates sans te faire prendre !' : '🔍 Trouve les imposteurs et termine tes tâches !'}`);
  }, 500);
});

// Un joueur s'est déplacé
socket.on('joueur_bouge', ({ id, x, y }) => {
  if (etat.joueurs[id] && id !== etat.monId) {
    etat.joueurs[id].x = x;
    etat.joueurs[id].y = y;
  }
});

// Un joueur est mort
socket.on('joueur_mort', ({ victimeId, corps }) => {
  if (etat.joueurs[victimeId]) {
    etat.joueurs[victimeId].vivant = false;
  }
  etat.corps.push(corps);
});

// Un joueur a quitté la partie
socket.on('joueur_parti', ({ id }) => {
  delete etat.joueurs[id];
});

// Début d'une réunion
socket.on('reunion_debut', (data) => {
  // Remet l'input chat visible (peut avoir été caché)
  document.getElementById('chat-input-zone').classList.remove('hidden');
  document.getElementById('zone-vote').classList.add('hidden');
  afficherReunion(data);
});

// Phase de vote
socket.on('vote_debut', ({ joueurs }) => {
  afficherPhaseVote(joueurs);
});

// Quelqu'un a voté
socket.on('vote_depose', ({ voteurId, nbVotes, nbJoueursVivants }) => {
  // Affiche l'état des votes dans le chat
  ajouterMessageSysteme(`📊 ${nbVotes}/${nbJoueursVivants} votes déposés`);
});

// Résultat de l'éjection
socket.on('ejection', ({ joueurId, pseudo, role, votes, egalite }) => {
  clearInterval(etat.minuterieVote);
  
  if (egalite) {
    ajouterMessageSysteme('⚖️ ÉGALITÉ ! Personne n\'est éjecté.');
  } else if (joueurId) {
    if (etat.joueurs[joueurId]) etat.joueurs[joueurId].vivant = false;
    const roleTexte = role === 'imposteur' ? '👾 C\'était un IMPOSTEUR !' : '😢 C\'était un CREWMATE...';
    ajouterMessageSysteme(`🚀 ${pseudo} a été éjecté ! ${roleTexte}`);
  }
  
  // Affiche 5 secondes puis retour au jeu
  setTimeout(() => {}, 5000);
});

// Retour au jeu après réunion
socket.on('retour_jeu', ({ joueurs }) => {
  etat.joueurs = joueurs;
  afficherEcran('jeu');
});

// Fin de partie
socket.on('fin_partie', (data) => {
  afficherFinPartie(data);
});

// Nouveau message dans le chat
socket.on('nouveau_message', ({ pseudo, couleur, texte }) => {
  const zone = document.getElementById('messages-chat');
  const msg = document.createElement('div');
  msg.className = 'message';
  msg.innerHTML = `
    <span class="message-pseudo" style="color:${couleur}">${pseudo}:</span>
    <span class="message-texte">${echapper(texte)}</span>
  `;
  zone.appendChild(msg);
  zone.scrollTop = zone.scrollHeight; // auto-scroll vers le bas
});

// ============================================================
// ÉVÉNEMENTS DU CLAVIER
// ============================================================

document.addEventListener('keydown', (e) => {
  // Si l'utilisateur tape dans un champ texte, on ne bloque rien
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  switch(e.code) {
    case 'ArrowUp':    case 'KeyZ': case 'KeyW': etat.touches.haut = true; break;
    case 'ArrowDown':  case 'KeyS': etat.touches.bas = true; break;
    case 'ArrowLeft':  case 'KeyQ': case 'KeyA': etat.touches.gauche = true; break;
    case 'ArrowRight': case 'KeyD': etat.touches.droite = true; break;
    case 'KeyE': // Tuer
      if (etat.monRole === 'imposteur') {
        const btn = document.getElementById('btn-tuer');
        if (!btn.classList.contains('hidden')) btn.click();
      }
      break;
    case 'KeyF': // Signaler
      const btnSig = document.getElementById('btn-signaler');
      if (!btnSig.classList.contains('hidden')) btnSig.click();
      break;
  }
  // On bloque le scroll de la page seulement pendant le jeu
  if (ecrans.jeu.classList.contains('actif')) e.preventDefault();
});

document.addEventListener('keyup', (e) => {
  // Si l'utilisateur tape dans un champ texte, on ignore
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  switch(e.code) {
    case 'ArrowUp':    case 'KeyZ': case 'KeyW': etat.touches.haut = false; break;
    case 'ArrowDown':  case 'KeyS': etat.touches.bas = false; break;
    case 'ArrowLeft':  case 'KeyQ': case 'KeyA': etat.touches.gauche = false; break;
    case 'ArrowRight': case 'KeyD': etat.touches.droite = false; break;
  }
});

// ============================================================
// BOUTONS DE L'INTERFACE
// ============================================================

// Créer une partie
document.getElementById('btn-creer').addEventListener('click', () => {
  const pseudo = document.getElementById('pseudo').value.trim();
  if (!pseudo) { afficherErreur('Entre un pseudo !'); return; }

  // Vérifie que le socket est bien connecté
  if (!socket.connected) {
    afficherErreur('Connexion au serveur en cours... Réessaie dans 2 secondes.');
    // Réessaie automatiquement dès que connecté
    socket.once('connect', () => {
      etat.monPseudo = pseudo;
      socket.emit('creer_partie', { pseudo });
    });
    return;
  }

  etat.monPseudo = pseudo;
  socket.emit('creer_partie', { pseudo });
  console.log('✅ creer_partie envoyé pour', pseudo);
});

// Rejoindre une partie
document.getElementById('btn-rejoindre').addEventListener('click', () => {
  const pseudo = document.getElementById('pseudo').value.trim();
  const code = document.getElementById('code-partie').value.trim();
  if (!pseudo) { afficherErreur('Entre un pseudo !'); return; }
  if (!code) { afficherErreur('Entre un code de partie !'); return; }
  etat.monPseudo = pseudo;
  socket.emit('rejoindre_partie', { pseudo, code });
});

// Copier le code de la partie
document.getElementById('btn-copier').addEventListener('click', () => {
  navigator.clipboard.writeText(etat.codePartie);
  document.getElementById('btn-copier').textContent = '✅';
  setTimeout(() => document.getElementById('btn-copier').textContent = '📋', 2000);
});

// Lancer la partie (hôte)
document.getElementById('btn-lancer').addEventListener('click', () => {
  socket.emit('lancer_partie');
});

// Boutons bots
document.querySelectorAll('.bouton-bot[data-total]').forEach(btn => {
  btn.addEventListener('click', () => {
    const nbTotal = parseInt(btn.dataset.total);
    socket.emit('ajouter_bots', { nbTotal });
  });
});

document.getElementById('btn-retirer-bots').addEventListener('click', () => {
  socket.emit('retirer_bots');
});

// Bouton tuer
document.getElementById('btn-tuer').addEventListener('click', () => {
  const cibleId = document.getElementById('btn-tuer').dataset.cible;
  if (cibleId) socket.emit('tuer', { cibleId });
});

// Bouton signaler
document.getElementById('btn-signaler').addEventListener('click', () => {
  const corpsId = document.getElementById('btn-signaler').dataset.corps;
  if (corpsId) socket.emit('signaler_corps', { corpsId });
});

// Bouton urgence
document.getElementById('btn-urgence').addEventListener('click', () => {
  socket.emit('urgence');
});

// Envoyer un message dans le chat
function envoyerMessage() {
  const input = document.getElementById('input-chat');
  const texte = input.value.trim();
  if (!texte) return;
  socket.emit('message_chat', { texte });
  input.value = '';
}

document.getElementById('btn-envoyer').addEventListener('click', envoyerMessage);
document.getElementById('input-chat').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') envoyerMessage();
  e.stopPropagation(); // Empêche les touches de chat d'activer le mouvement
});

// Passer le vote
document.getElementById('btn-skip').addEventListener('click', () => voter('skip'));

// Rejouer
document.getElementById('btn-rejouer').addEventListener('click', () => {
  window.location.reload();
});

// ---- CONTRÔLES TACTILES MOBILES ----
const touchesMobile = {
  'btn-haut': 'haut',
  'btn-bas': 'bas',
  'btn-gauche': 'gauche',
  'btn-droite': 'droite'
};

for (const [btnId, touche] of Object.entries(touchesMobile)) {
  const btn = document.getElementById(btnId);
  btn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    etat.touches[touche] = true;
  });
  btn.addEventListener('touchend', (e) => {
    e.preventDefault();
    etat.touches[touche] = false;
  });
  btn.addEventListener('mousedown', () => etat.touches[touche] = true);
  btn.addEventListener('mouseup', () => etat.touches[touche] = false);
}

// ============================================================
// FONCTIONS UTILITAIRES CLIENT
// ============================================================

// Empêche les injections HTML dans le chat
function echapper(texte) {
  return texte
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Ajoute un message système dans le chat
function ajouterMessageSysteme(texte) {
  const zone = document.getElementById('messages-chat');
  if (!zone) return;
  const msg = document.createElement('div');
  msg.className = 'message';
  msg.innerHTML = `<span class="message-texte" style="color:#7fafd0;font-style:italic">— ${texte}</span>`;
  zone.appendChild(msg);
  zone.scrollTop = zone.scrollHeight;
}

// Mise à jour du lobby — appelé quand on crée/rejoint une partie ou qu'un joueur arrive
socket.on('mise_a_jour_lobby', ({ joueurs, code }) => {
  etat.codePartie = code;
  document.getElementById('code-lobby').textContent = code;
  mettreAJourLobby(joueurs, code);

  // Détermine si on est hôte
  const moi = joueurs[socket.id];
  if (moi && moi.estHote) {
    document.getElementById('btn-lancer').classList.remove('hidden');
    document.getElementById('zone-bots').classList.remove('hidden');
    document.getElementById('attente-hote').classList.add('hidden');
  } else if (moi && !moi.estHote) {
    document.getElementById('btn-lancer').classList.add('hidden');
    document.getElementById('zone-bots').classList.add('hidden');
    document.getElementById('attente-hote').classList.remove('hidden');
  }

  // Va au lobby si on n'y est pas encore (et pas en train de jouer)
  if (!ecrans.jeu.classList.contains('actif') &&
      !ecrans.reunion.classList.contains('actif') &&
      !ecrans.fin.classList.contains('actif')) {
    afficherEcran('lobby');
  }
});

// Appui Entrée pour créer/rejoindre depuis l'accueil
document.getElementById('pseudo').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-creer').click();
});
document.getElementById('code-partie').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-rejoindre').click();
});
