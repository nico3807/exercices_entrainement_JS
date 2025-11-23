// --- 1. INITIALISATION ---

const editorElement = document.getElementById("editor");
const codeMirrorInstance = CodeMirror.fromTextArea(editorElement, {
  lineNumbers: true,
  mode: "javascript",
  theme: "dracula",
  lineWrapping: true,
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

// Variable pour stocker l'exercice (texte complet pour l'assistant)
let currentExerciseText = "Aucun exercice généré pour le moment.";

// --- 2. EXÉCUTION DU CODE (RunCode) ---

function runCode() {
  const rawCode = codeMirrorInstance.getValue();

  // 🛡️ SÉCURITÉ : Échappement des caractères spéciaux
  let code = rawCode.replace(/`/g, "\\`");
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
    Tu dois proposer un exercice de programmation en javascript à résoudre sur les bases du javascript.
    Les questions seront en lien avec le programme national du but mmi.
    Les exemples porteront sur le développement web et/ou sur des cas concrets simples en lien avec les jeux vidéos.
    Adresse toi directement à l'étudiant.
    Donne directement l'énoncé de l'exercice sans introduction ni conclusion.
    L'exercice portera sur un petit script que l'étudiant pourra tester directement dans un éditeur codemirror. 
    L'énoncé ne dépassera 200 mots. 
    Tu placeras l'énoncé dans un paragraphe nommé obligatoirement "🎯 Consignes".
    Après l'énoncé, tu feras un paragraphe nommé obligatoirement "Code à Compléter". 
    Tu rajouteras après ce paragraphe un code javascript incomplet que l'étudiant devra compléter.
    Formatte la réponse en Markdown.`;

  const userQuery =
    "Génère un nouvel exercice JavaScript pour un étudiant débutant.";

  try {
    const result = await callGemini(systemPrompt, userQuery);
    const text = result || "Erreur de génération.";

    // Sauvegarde du texte complet pour l'assistant (il a besoin du contexte complet)
    currentExerciseText = text;

    // --- ⭐️ LOGIQUE DE SÉPARATION (Consignes VS Code) ---

    // On cherche le marqueur "Code à Compléter" (avec ou sans balises markdown autour)
    // Le regex cherche "Code à Compléter" en étant flexible sur la casse et les symboles (#, *)
    const separatorRegex =
      /#{1,6}\s*Code à Compléter|\*\*Code à Compléter\*\*|Code à Compléter/i;
    const splitMatch = text.match(separatorRegex);

    let instructionsPart = text;
    let codePart = "// Écris ton code ici pour résoudre l'exercice !";

    if (splitMatch) {
      const splitIndex = splitMatch.index;

      // 1. Partie Instructions : Tout ce qui est AVANT le séparateur
      instructionsPart = text.substring(0, splitIndex).trim();

      // 2. Partie Code : Tout ce qui est APRÈS le séparateur (+ la longueur du séparateur)
      let rawCodePart = text
        .substring(splitIndex + splitMatch[0].length)
        .trim();

      // Nettoyage du code : On enlève les balises Markdown (```javascript ... ```)
      // On enlève ```javascript ou ```js au début, et ``` à la fin
      codePart = rawCodePart
        .replace(/^```(javascript|js)?/i, "")
        .replace(/```$/, "")
        .trim();
    }

    // Mise à jour de l'affichage de l'énoncé (sans le code)
    const htmlContent = formatMarkdown(instructionsPart);
    exerciseContainer.innerHTML = `<h3>Énoncé de l'exercice :</h3><div class="markdown-content">${htmlContent}</div>`;

    // Mise à jour de l'éditeur avec le code extrait
    codeMirrorInstance.setValue(codePart);
  } catch (error) {
    console.error(error);
    exerciseContainer.innerHTML = `<h3>Énoncé de l'exercice :</h3><p style="color: red;">Erreur lors de la génération. Réessayez...</p>`;
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
Si son code est correct, félicite-le. Sinon, aide-le à trouver l'erreur.
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

if (newExerciseButton)
  newExerciseButton.addEventListener("click", generateExercise);

if (assistantButton) assistantButton.addEventListener("click", askAssistant);
if (closeModalButton)
  closeModalButton.addEventListener("click", closeAssistant);

window.onclick = function (event) {
  if (event.target == assistantModal) {
    closeAssistant();
  }
};

// Lancement initial
runCode();
