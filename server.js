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
  if (modelId) return modelId;

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

function normalizeList(value) {
  if (!Array.isArray(value)) return [];

  return value
    .filter(item => typeof item === "string")
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function cleanAnalysis(data) {
  const result = {
    goal:
      typeof data.goal === "string"
        ? data.goal.trim()
        : "",

    skills: normalizeList(data.skills),
    constraints: normalizeList(data.constraints),
    blockers: normalizeList(data.blockers),
    opportunities: normalizeList(data.opportunities)
  };

  // Words and phrases that usually indicate facts/constraints
  // rather than genuine opportunities.
  const constraintPatterns = [
    /\$\s?\d+/i,
    /\d+\s*(hours?|hrs?|minutes?|days?|weeks?|months?)/i,
    /\bavailable\b/i,
    /\bbudget\b/i,
    /\blimited\b/i,
    /\btime\b/i
  ];

  // Remove opportunities that are actually constraints.
  result.opportunities = result.opportunities.filter(item => {
    return !constraintPatterns.some(pattern =>
      pattern.test(item)
    );
  });

  // Remove opportunities that simply repeat skills.
  result.opportunities = result.opportunities.filter(item => {
    return !result.skills.some(skill =>
      item.toLowerCase() === skill.toLowerCase()
    );
  });

  // Remove duplicate items inside each category.
  for (const key of [
    "skills",
    "constraints",
    "blockers",
    "opportunities"
  ]) {
    result[key] = [
      ...new Map(
        result[key].map(item => [
          item.toLowerCase(),
          item
        ])
      ).values()
    ];
  }

  return result;
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

DEFINITIONS:

GOAL:
The main thing the user wants to accomplish.

SKILLS:
Abilities, knowledge, experience, or resources the user explicitly mentions.

CONSTRAINTS:
Limits such as money, time, equipment, tools, location, or resources.

BLOCKERS:
Specific problems that could prevent the user from reaching the goal.

OPPORTUNITIES:
Specific actions, strategies, markets, ideas, or possibilities
that could help the user reach the goal.

IMPORTANT:

"$500" is a constraint, NOT an opportunity.

"3 hours per day" is a constraint, NOT an opportunity.

"Video editing" is a skill, NOT an opportunity.

An opportunity should describe something useful that the user
could potentially DO or pursue.

For example:

"Offer short-form video editing to small businesses"

"Target local businesses that need social media videos"

"Start with freelance projects requiring little upfront cost"

Do not invent personal information.

Only use information supported by the user's thought.

Keep every item short and specific.

If there is not enough information for a category,
return an empty array.

Return ONLY JSON.
Do not use markdown.
Do not include explanations.

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

function extractJson(text) {
  const cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error("QVAC did not return valid JSON.");
  }

  return cleaned.slice(firstBrace, lastBrace + 1);
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

      let parsed;

      try {
        parsed = JSON.parse(body || "{}");
      } catch {
        res.writeHead(400, {
          "Content-Type": "application/json"
        });

        res.end(JSON.stringify({
          error: "Invalid request."
        }));

        return;
      }

      const thought = parsed.thought;

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

      const json = extractJson(rawResult);
      const aiResult = JSON.parse(json);

      const finalResult = cleanAnalysis(aiResult);

      res.writeHead(200, {
        "Content-Type": "application/json"
      });

      res.end(JSON.stringify({
        result: JSON.stringify(finalResult)
      }));

      return;
    }

    if (req.method === "GET") {

  if (req.url === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }

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