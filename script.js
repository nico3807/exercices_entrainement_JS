// --- 1. INITIALISATION ---

const editorElement = document.getElementById("editor");
const codeMirrorInstance = CodeMirror.fromTextArea(editorElement, {
  lineNumbers: true,
  mode: "javascript",
  theme: "dracula",
  lineWrapping: true,
});

if (typeof APP_CONFIG === "undefined") {
  document.body.innerHTML =
    '<p style="color:red; padding:20px;">Fichier config.js manquant.</p>';
  throw new Error("config.js introuvable.");
}

const API_KEY = APP_CONFIG.API_KEY;
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-latest:generateContent?key=${API_KEY}`;
// Éléments du DOM
const exerciseContainer = document.getElementById("exerciseContainer");
const newExerciseButton = document.getElementById("newExerciseButton");
const assistantModal = document.getElementById("assistantModal");
const assistantContent = document.getElementById("assistantContent");
const closeModalButton = document.getElementById("closeModalButton");
const assistantButton = document.getElementById("assistantButton");
const topicModal = document.getElementById("topicModal");
const closeTopicButton = document.getElementById("closeTopicButton");
// ⭐️ NOUVEAU : Éléments de la modale d'exécution
const executionModal = document.getElementById("executionModal");
const closeExecutionButton = document.getElementById("closeExecutionButton");

// Variable pour stocker l'exercice (texte complet pour l'assistant)
let currentExerciseText = "Aucun exercice généré pour le moment.";
let lastError = null;

// --- 2. EXÉCUTION DU CODE (RunCode) ---

// --- 2. EXÉCUTION DU CODE (RunCode) ---

function runCode() {
  // ⭐️ NOUVEAU : On ouvre la pop-up dès qu'on lance le test
  if (executionModal) executionModal.style.display = "block";

  // Réinitialisation de l'état d'erreur
  lastError = null;
  const existingErrorBtn = document.getElementById("errorExplainBtn");
  if (existingErrorBtn) existingErrorBtn.remove();

  const rawCode = codeMirrorInstance.getValue();

  // 🛡️ SÉCURITÉ : Échappement des caractères spéciaux
  // L'ordre est CRUCIAL : on échappe d'abord les antislashs (\)
  // Sinon, on échapperait les antislashs ajoutés pour les autres caractères !
  let code = rawCode.replace(/\\/g, "\\\\");
  code = code.replace(/`/g, "\\`");
  code = code.replace(/\${/g, "\\${");

  const outputFrame = document.getElementById("outputFrame");
  const iframeDoc =
    outputFrame.contentDocument || outputFrame.contentWindow.document;

  iframeDoc.open();
  iframeDoc.write(`
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { font-family: monospace; margin: 0; padding: 10px; background-color: #dedede; }
            pre { font-size: 16px; margin: 0; white-space: pre-wrap; word-wrap: break-word; }
        </style>
    </head>
    <body><div id="script-target"></div></body>
    </html>
  `);
  iframeDoc.close();

  setTimeout(() => {
    const scriptElement = iframeDoc.createElement("script");
    // On insère le code sécurisé dans le gabarit
    const scriptContent = `
        var originalLog = console.log;
        console.log = function(...args) {
            const message = args.map(arg => {
                return (typeof arg === 'object' && arg !== null) ? JSON.stringify(arg, null, 2) : String(arg);
            }).join(' ');
            const p = document.createElement('pre');
            p.textContent = message;
            document.body.appendChild(p);
        };
        try {
            ${code}
        } catch (e) {
            const p = document.createElement('pre');
            p.style.color = 'red';
            p.textContent = 'Erreur: ' + e.message;
            document.body.appendChild(p);
            window.parent.postMessage({ type: 'error', message: e.message }, '*');
        }
    `;
    scriptElement.textContent = scriptContent;
    const target = iframeDoc.getElementById("script-target");
    if (target) target.appendChild(scriptElement);
  }, 50);
}

// --- 3. GÉNÉRATION D'EXERCICE ---

// --- 3. GÉNÉRATION D'EXERCICE (Modifiée) ---

// Fonction 1 : Appelée quand on clique sur un bouton de sujet
async function loadPromptAndRun(fileName) {
  // 1. On ferme la modale de choix
  topicModal.style.display = "none";

  // 2. On essaie de lire le fichier texte correspondant
  try {
    const response = await fetch("./" + fileName); // Suppose que les fichiers sont à la racine
    if (!response.ok) throw new Error("Fichier introuvable");
    const promptContent = await response.text();

    // 3. On lance la génération avec ce contenu spécifique
    generateExercise(promptContent);
  } catch (error) {
    alert(
      "Erreur : Impossible de lire le fichier " +
        fileName +
        ". Vérifie qu'il existe !",
    );
    console.error(error);
  }
}

// Fonction 2 : La génération (Mise à jour pour accepter les instructions)
async function generateExercise(specificInstructions = "") {
  if (newExerciseButton) newExerciseButton.disabled = true;

  exerciseContainer.innerHTML =
    '<p style="color: #e15c37ff;">Création de l\'exercice en cours... 🤖</p>';

  // Le prompt "Système" reste le cadre général (Persona + Format de réponse)
  // J'ai retiré la partie "Contexte" pour la laisser au fichier texte spécifique
  const baseSystemPrompt = `
    Tu es un professeur expert en pédagogie pour le BUT MMI. 
    Tu dois créer un exercice court de JavaScript.
    
    Contraintes de rédaction :
    - Adresse-toi directement à l'étudiant (tu).
    - Pas d'introduction ni de conclusion.
    - L'énoncé ne doit pas dépasser 400 mots.
    
    Structure OBLIGATOIRE de la réponse (Respecte scrupuleusement le Markdown) :
    🎯 Consignes
    [Insérer l'énoncé]
    
    Code à Compléter
    [Insérer le bloc de code JS]
  `;

  // On combine la demande utilisateur avec le contenu du fichier texte
  const userQuery = `Génère un exercice JavaScript débutant. 
  Voici les consignes pédagogiques spécifiques à respecter pour cet exercice : 
  ${specificInstructions}`;

  try {
    const result = await callGemini(baseSystemPrompt, userQuery);
    const text = result || "Erreur de génération.";

    currentExerciseText = text; // Sauvegarde pour l'assistant

    // --- LOGIQUE DE SÉPARATION (Identique à avant) ---
    const separatorRegex =
      /#{1,6}\s*Code à Compléter|\*\*Code à Compléter\*\*|Code à Compléter/i;
    const splitMatch = text.match(separatorRegex);

    let instructionsPart = text;
    let codePart = "// Code ici...";

    if (splitMatch) {
      const splitIndex = splitMatch.index;
      instructionsPart = text.substring(0, splitIndex).trim();
      let rawCodePart = text
        .substring(splitIndex + splitMatch[0].length)
        .trim();
      codePart = rawCodePart
        .replace(/^```(javascript|js)?/i, "")
        .replace(/```$/, "")
        .trim();
    }

    exerciseContainer.innerHTML = `<div class="markdown-content">${formatMarkdown(
      instructionsPart,
    )}</div>`;
    codeMirrorInstance.setValue(codePart);
  } catch (error) {
    console.error(error);
    exerciseContainer.innerHTML = `<p style="color: red;">Erreur API. Ça arrive... Regénère l'exercice !</p>`;
  } finally {
    if (newExerciseButton) newExerciseButton.disabled = false;
  }
}

// --- 4. ASSISTANT PÉDAGOGIQUE (Pop-up) ---

async function askAssistant() {
  assistantModal.style.display = "block";
  assistantContent.innerHTML =
    '<p style="color: #bd93f9; text-align: center; margin-top: 50px;">Analyse de ton code en cours... 🧐</p>';

  const studentCode = codeMirrorInstance.getValue();
  // Pour l'assistant, on garde le texte complet (currentExerciseText) s'il existe
  const exerciseText =
    currentExerciseText.length > 20
      ? currentExerciseText
      : exerciseContainer.innerText;

  const systemPrompt = `
Tu es un expert en développement javascript.
Tu dois aider un étudiant de première année en BUT MMI.
Tu ne dois jamais donner la correction de l'exercice, juste des indices.
Tu dois t'exprimer en français.
Si le code est correct, félicite-le. Sinon, aide-le à trouver l'erreur.
`;

  const userQuery = `
Voici l'exercice complet proposé à l'étudiant : 
${exerciseText}

Voici le programme proposé par l'étudiant : 
${studentCode}
`;

  try {
    const result = await callGemini(systemPrompt, userQuery);
    assistantContent.innerHTML = formatMarkdown(result);
  } catch (error) {
    assistantContent.innerHTML = `<p style="color: #ff5555;">Erreur d'analyse (${error.message})</p>`;
  }
}

function closeAssistant() {
  assistantModal.style.display = "none";
}

// --- 4b. GESTION DES ERREURS (Debug Assistant) ---

window.addEventListener("message", (event) => {
  if (event.data && event.data.type === "error") {
    lastError = event.data.message;
    addErrorButton();
  }
});

function addErrorButton() {
  const footer = executionModal.querySelector(".modal-footer");
  if (!footer || document.getElementById("errorExplainBtn")) return;

  const btn = document.createElement("button");
  btn.id = "errorExplainBtn";
  btn.textContent = "Expliquer l'erreur 🚑";
  btn.style.backgroundColor = "#ff5555";
  btn.style.color = "white";
  btn.style.marginRight = "10px";
  btn.onclick = explainError;

  // Insère le bouton avant le bouton "Fermer"
  footer.insertBefore(btn, footer.firstChild);
}

async function explainError() {
  if (!lastError) return;

  executionModal.style.display = "none";
  assistantModal.style.display = "block";
  assistantContent.innerHTML =
    '<p style="color: #bd93f9; text-align: center; margin-top: 50px;">Analyse de l\'erreur en cours... 🚑</p>';

  const studentCode = codeMirrorInstance.getValue();
  const systemPrompt =
    "Tu es un expert en pédagogie JavaScript. Explique l'erreur rencontrée par l'étudiant simplement et donne une piste de correction sans donner la solution complète.";
  const userPrompt = `Code de l'étudiant :\n${studentCode}\n\nErreur rencontrée :\n${lastError}`;

  try {
    const result = await callGemini(systemPrompt, userPrompt);
    assistantContent.innerHTML = formatMarkdown(result);
  } catch (error) {
    assistantContent.innerHTML = `<p style="color: #ff5555;">Erreur d'analyse (${error.message})</p>`;
  }
}

// --- 5. UTILITAIRES ---

async function callGemini(systemPrompt, userPrompt) {
  const payload = {
    contents: [{ parts: [{ text: userPrompt }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
  };

  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) throw new Error(`Erreur API: ${response.status}`);
  const result = await response.json();
  return result.candidates?.[0]?.content?.parts?.[0]?.text;
}

function formatMarkdown(text) {
  if (!text) return "";
  let html = text;
  html = html.replace(/^###\s*(.*$)/gim, "<h4>$1</h4>");
  html = html.replace(/^##\s*(.*$)/gim, "<h3>$1</h3>");
  html = html.replace(/\*\*(.*?)\*\*/gim, "<strong>$1</strong>");
  html = html.replace(/\*(.*?)\*/gim, "<em>$1</em>");
  html = html.replace(/\n/g, "<br>");
  return html;
}

// --- 6. ÉVÉNEMENTS ---

const runBtn = document.getElementById("runButton");
if (runBtn) runBtn.addEventListener("click", runCode);

if (newExerciseButton) {
  newExerciseButton.addEventListener("click", () => {
    topicModal.style.display = "block";
  });
}

// Gestion fermeture modale Sujet
if (closeTopicButton) {
  closeTopicButton.addEventListener("click", () => {
    topicModal.style.display = "none";
  });
}

// Mise à jour de la fermeture globale au clic dehors
window.onclick = function (event) {
  if (event.target == assistantModal) assistantModal.style.display = "none";
  if (event.target == executionModal) executionModal.style.display = "none";
  if (event.target == topicModal) topicModal.style.display = "none"; // Ajout ici
};
if (assistantButton) assistantButton.addEventListener("click", askAssistant);
if (closeModalButton)
  closeModalButton.addEventListener("click", closeAssistant);

// Gestion du bouton fermer de la modale d'exécution
if (closeExecutionButton) {
  closeExecutionButton.addEventListener("click", () => {
    executionModal.style.display = "none";
  });
}

// Gestion globale des clics en dehors des fenêtres
// ⭐️ CORRECTION : Une seule fonction window.onclick propre
window.onclick = function (event) {
  if (event.target == assistantModal) {
    closeAssistant();
  }
  if (event.target == executionModal) {
    executionModal.style.display = "none";
  }
};
