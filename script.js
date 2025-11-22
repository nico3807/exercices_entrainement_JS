// --- 1. INITIALISATION ---

const editorElement = document.getElementById("editor");
const codeMirrorInstance = CodeMirror.fromTextArea(editorElement, {
  lineNumbers: true,
  mode: "javascript",
  theme: "dracula",
  lineWrapping: true, // ⭐️ C'est cette option qui force le retour à la ligne !
});

// Clé API et Configuration
const API_KEY = "AIzaSyCwlGNH4z-pqb0b3GbP4dyACEu5dDiMJ_o";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${API_KEY}`;

// Éléments du DOM
const exerciseContainer = document.getElementById("exerciseContainer");
const newExerciseButton = document.getElementById("newExerciseButton");
const assistantModal = document.getElementById("assistantModal");
const assistantContent = document.getElementById("assistantContent");
const closeModalButton = document.getElementById("closeModalButton");
const assistantButton = document.getElementById("assistantButton");

// Variable pour stocker l'exercice
let currentExerciseText = "Aucun exercice généré pour le moment.";

// --- 2. EXÉCUTION DU CODE (RunCode) ---

function runCode() {
  const rawCode = codeMirrorInstance.getValue();

  // 🛡️ SÉCURITÉ CRITIQUE :
  // Il faut échapper les backticks (`) ET les interpolations (${)
  // Sinon le code de l'étudiant casse le script d'injection.
  let code = rawCode.replace(/`/g, "\\`");
  code = code.replace(/\${/g, "\\${");

  const outputFrame = document.getElementById("outputFrame");
  const iframeDoc =
    outputFrame.contentDocument || outputFrame.contentWindow.document;

  // Nettoyage et préparation de l'iframe
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

  // Injection du script après un court délai
  setTimeout(() => {
    const scriptElement = iframeDoc.createElement("script");
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
        }
    `;
    scriptElement.textContent = scriptContent;
    const target = iframeDoc.getElementById("script-target");
    if (target) target.appendChild(scriptElement);
  }, 50);
}

// --- 3. GÉNÉRATION D'EXERCICE ---

async function generateExercise() {
  if (newExerciseButton) newExerciseButton.disabled = true;
  exerciseContainer.innerHTML =
    "<h3>Énoncé de l'exercice :</h3><p style=\"color: #e15c37ff;\">Chargement de l'exercice... 🤖</p>";

  const systemPrompt = `
    Tu es un professeur en développement web en javascript. 
    Tu as des étudiants en BUT MMI première année. 
    Tu dois proposer un exercice de programmation en javascript à résoudre sur les bases du javascript (déclaration de variables, calculs, fonctions, fonctions if, for, les tableaux, etc...). 
    Les questions seront en lien avec le programme national du but mmi.
    Les exemples porteront sur le développement web et/ou sur des cas concrets simples en lien avec les jeux vidéos..
    Adresse toi directement à l'étudiant.
    donne directement l'énoncé de l'exercice sans introduction ni conclusion.
    L'exercice portera sur un petit script que l'étudiant pourra tester directement dans un éditeur codemirror. 
    L'énoncé ne dépassera 200 mots. 
    Formatte la réponse en Markdown.`;
  const userQuery =
    "Génère un nouvel exercice JavaScript pour un étudiant débutant.";

  try {
    const result = await callGemini(systemPrompt, userQuery);
    const text = result || "Erreur de génération.";

    currentExerciseText = text;

    const htmlContent = formatMarkdown(text);
    exerciseContainer.innerHTML = `<h3>Énoncé de l'exercice :</h3><div class="markdown-content">${htmlContent}</div>`;
    codeMirrorInstance.setValue(
      "// Écris ton code ici pour résoudre l'exercice !"
    );
  } catch (error) {
    console.error(error);
    exerciseContainer.innerHTML = `<h3>Énoncé de l'exercice :</h3><p style="color: red;">Erreur lors de la génération. Réessayez de générer la question...</p>`;
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
  const exerciseText =
    currentExerciseText.length > 20
      ? currentExerciseText
      : exerciseContainer.innerText;

  const systemPrompt = `
Tu es un expert en développement javascript.
Tu dois aider un étudiant de première année en BUT MMI à résoudre un exercice de programmation en javascript.
Tu ne dois jamais donner la correction de l'exercice (même partiellement) à l'étudiant, juste lui donner des indications lui permettant de résoudre lui-même l'exercice.
Tu dois t'adresser directement à l'étudiant.
Il ne peut pas te poser des questions, il peut juste te proposer son code.
Tu ne dois pas proposer à l'étudiant de te poser des questions.
Il est inutile de proposer à l'étudiant de tester son code avec les exemples proposés.
Tu ne dois pas lui proposer des modifications du programme qui sortent du cadre de l'exercice.
Si son code est correct (tu dois alors lui dire que son code est correct et éventuellement lui donner des conseils pour encore en améliorer la qualité). Si son code est erroné ou ne fonctionne pas, tu dois aider l'étudiant à trouver ses erreurs.
Tu dois t'exprimer en français.
`;

  const userQuery = `
Voici l'exercice proposé à l'étudiant : 
${exerciseText}

Voici le programme proposé par l'étudiant : 
${studentCode}
`;

  try {
    const result = await callGemini(systemPrompt, userQuery);
    assistantContent.innerHTML = formatMarkdown(result);
  } catch (error) {
    assistantContent.innerHTML = `<p style="color: #ff5555;">Oups, je n'arrive pas à analyser ton code pour le moment. (${error.message})</p>`;
  }
}

function closeAssistant() {
  assistantModal.style.display = "none";
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

// On vérifie que les éléments existent avant d'ajouter les écouteurs
const runBtn = document.getElementById("runButton");
if (runBtn) runBtn.addEventListener("click", runCode);

if (newExerciseButton)
  newExerciseButton.addEventListener("click", generateExercise);

if (assistantButton) assistantButton.addEventListener("click", askAssistant);
if (closeModalButton)
  closeModalButton.addEventListener("click", closeAssistant);

// Fermer si on clique en dehors de la modale (sur le fond gris)
window.onclick = function (event) {
  if (event.target == assistantModal) {
    closeAssistant();
  }
};

// Lancement initial
runCode();
