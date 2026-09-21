import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadModel,
  completion,
  LLAMA_3_2_1B_INST_Q4_0
} from "@qvac/sdk";

const PORT = 3000;
const root = fileURLToPath(new URL(".", import.meta.url));

let modelId = null;

async function getModel() {
  if (modelId) {
    return modelId;
  }

  console.log("Loading QVAC local model...");

  modelId = await loadModel({
    modelSrc: LLAMA_3_2_1B_INST_Q4_0,
    onProgress: (progress) => {
      console.log(
        `Model loading: ${progress.percentage.toFixed(0)}%`
      );
    }
  });

  console.log("QVAC model loaded.");

  return modelId;
}

async function analyzeThought(thought) {
  const id = await getModel();

  const prompt = `
You are MindTrace, a local AI thinking-mapping engine.

Analyze the user's thought and return ONLY valid JSON.

Use exactly this structure:

{
  "goal": "one clear main goal",
  "skills": [],
  "constraints": [],
  "blockers": [],
  "opportunities": []
}

RULES:

GOAL:
Identify the main thing the user wants to accomplish.
Keep it short and specific.

SKILLS:
Include only abilities, knowledge, experience, or resources
the user explicitly mentions.
Never invent skills.

CONSTRAINTS:
Include real limitations such as money, time, equipment,
experience, tools, or other resources.
Do not simply repeat ordinary facts.

BLOCKERS:
Identify specific problems that could prevent the user
from reaching the goal.
Only include blockers supported by the user's thought.
If none are known, return an empty array.

OPPORTUNITIES:
Identify realistic, useful, actionable possibilities
that could help the user reach the goal.
Do NOT repeat skills, constraints, or facts.

For example:
"$500 available" is a constraint.
"3 hours per day" is a constraint.
"Video editing" is a skill.
"Offer short-form video editing to small businesses"
is an opportunity.

GENERAL RULES:
- Do not invent personal information.
- Keep every item short and specific.
- Use empty arrays when information is unknown.
- Return ONLY JSON.
- Do not use markdown.
- Do not include explanations outside the JSON.

User thought:
${thought}
`;

  const result = completion({
    modelId: id,
    history: [
      {
        role: "user",
        content: prompt
      }
    ],
    stream: true
  });

  let output = "";

  for await (const token of result.tokenStream) {
    output += token;
  }

  return output.trim();
}

function cleanJson(text) {
  let cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  return cleaned;
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8"
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/analyze") {
      let body = "";

      for await (const chunk of req) {
        body += chunk;
      }

      let parsedBody;

      try {
        parsedBody = JSON.parse(body || "{}");
      } catch {
        res.writeHead(400, {
          "Content-Type": "application/json"
        });

        res.end(JSON.stringify({
          error: "Invalid request."
        }));

        return;
      }

      const thought = parsedBody.thought;

      if (!thought || thought.trim().length < 3) {
        res.writeHead(400, {
          "Content-Type": "application/json"
        });

        res.end(JSON.stringify({
          error: "Please enter a thought."
        }));

        return;
      }

      console.log("Analyzing thought with QVAC...");

      const rawResult = await analyzeThought(
        thought.trim().slice(0, 3000)
      );

      const cleanedResult = cleanJson(rawResult);

      // Verify that QVAC actually returned valid JSON.
      try {
        JSON.parse(cleanedResult);
      } catch {
        console.error("QVAC returned invalid JSON:");
        console.error(rawResult);

        res.writeHead(500, {
          "Content-Type": "application/json"
        });

        res.end(JSON.stringify({
          error: "QVAC returned an invalid analysis. Please try again."
        }));

        return;
      }

      res.writeHead(200, {
        "Content-Type": "application/json"
      });

      res.end(JSON.stringify({
        result: cleanedResult
      }));

      return;
    }

    if (req.method === "GET") {
      const requestedPath =
        req.url === "/" ? "/index.html" : req.url;

      const safePath = requestedPath
        .replace(/\.\./g, "")
        .replace(/^\/+/, "");

      const filePath = join(root, safePath);

      const file = await readFile(filePath);

      const type =
        mimeTypes[extname(filePath)] ||
        "application/octet-stream";

      res.writeHead(200, {
        "Content-Type": type
      });

      res.end(file);

      return;
    }

    res.writeHead(404);
    res.end("Not found");

  } catch (error) {
    console.error("Server error:", error);

    res.writeHead(500, {
      "Content-Type": "application/json"
    });

    res.end(JSON.stringify({
      error: error.message || "Server error"
    }));
  }
});

server.listen(PORT, () => {
  console.log(
    `MindTrace running at http://localhost:${PORT}`
  );
});