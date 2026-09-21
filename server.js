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

async function analyzeThought(thought) {
  const id = await getModel();

  const prompt = `
You are MindTrace, a local AI thinking-mapping engine.

Analyze the user's thought and return ONLY valid JSON.

Use exactly this structure:

{
  "goal": "main goal",
  "skills": ["skill 1", "skill 2"],
  "constraints": ["constraint 1", "constraint 2"],
  "blockers": ["blocker 1", "blocker 2"],
  "opportunities": ["opportunity 1", "opportunity 2"]
}

Keep each item short and specific.
Do not invent personal information.
If something is unknown, use an empty array.

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

      const { thought } = JSON.parse(body || "{}");

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

      const result = await analyzeThought(
        thought.trim().slice(0, 3000)
      );

      res.writeHead(200, {
        "Content-Type": "application/json"
      });

      res.end(JSON.stringify({
        result
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
    console.error(error);

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