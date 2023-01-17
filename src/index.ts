import { PlayerDetails } from "./PlayerDetails.js";
import { TokensRow } from "./TokensRow";

import * as dotenv from "dotenv";
dotenv.config();

import OBSWebSocket from "obs-websocket-js";

import { RefreshingAuthProvider } from "@twurple/auth";
import { ChatClient } from "@twurple/chat";

import { WebSocketServer } from "ws";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import Database from "better-sqlite3";

if (!existsSync(".env") || (existsSync(".env") && readFileSync(".env").length === 0)) {
  writeFileSync(".env", readFileSync("src/default.env"));
  throw new Error("No .env file found - an empty file has been created, please fill it!");
}

if (!existsSync("./db/")) {
  mkdirSync("./db/");
}

const db = new Database("./db/twitchproxy.db");
db.pragma("journal_mode = WAL");

db.prepare(
  "CREATE TABLE IF NOT EXISTS tokens (access_token TEXT, refresh_token TEXT, expires_in INTEGER, obtainment_timestamp INTEGER)"
).run();

db.prepare(
  "INSERT OR IGNORE INTO tokens (access_token, refresh_token, expires_in, obtainment_timestamp) VALUES (NULL, NULL, NULL, NULL)"
).run();

const tokens: TokensRow = db.prepare("SELECT * FROM tokens").get();

if (tokens === undefined) {
  throw new Error("Please add initial tokens to database");
}

let isRoundIntermission = false;
let isRoundInProgress = false;

let playersQueuedForRound: PlayerDetails[] = [];

// Connect to OBS for handling scene stuff
const obs = new OBSWebSocket();
await obs.connect(`ws://127.0.0.1:${process.env.OBS_PORT}`, process.env.OBS_PASSWORD);

// Connec to Twitch auth
const authProvider = new RefreshingAuthProvider(
  {
    clientId: process.env.CLIENT_ID!,
    clientSecret: process.env.CLIENT_SECRET!,
    onRefresh: (token) => {
      db.prepare("UPDATE tokens SET access_token = ?, refresh_token = ?, expires_in = ?, obtainment_timestamp = ?").run(
        token.accessToken,
        token.refreshToken,
        token.expiresIn,
        token.obtainmentTimestamp
      );
    },
  },
  {
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    expiresIn: tokens.expires_in,
    obtainmentTimestamp: tokens.obtainment_timestamp,
  }
);

// Connect to Twitch IRC
const chatClient = new ChatClient({ authProvider, channels: [process.env.CHANNEL_NAME!] });

chatClient.onRegister(() => {
  console.log("Connected as", chatClient.currentNick);
});

chatClient.onMessage(async (channel, user, message, msg) => {
  if (
    (isRoundIntermission || isRoundInProgress) &&
    (message.toLowerCase() === "!play" || message.toLowerCase() === "play" || message.toLowerCase() === "! play")
  ) {
    if (playersQueuedForRound.map((p) => p.name).includes(user)) {
      if (isRoundIntermission) {
        await chatClient.say(channel, `already in this round cmonBruh`, { replyTo: msg.id });
      } else if (isRoundInProgress) {
        await chatClient.say(channel, `already queued for next round cmonBruh`, { replyTo: msg.id });
      }
    } else {
      if (isRoundIntermission) {
        await chatClient.say(channel, `joining this round :)`, { replyTo: msg.id });
      } else if (isRoundInProgress) {
        await chatClient.say(channel, `joining next round ResidentSleeper`, { replyTo: msg.id });
      }

      let player = {
        name: user!,
        userId: msg.userInfo.userId!,
        color: msg.userInfo.color!,
      };

      playersQueuedForRound.push(player);

      wss.clients.forEach((c) => c.send(JSON.stringify({ event: "player", player })));
    }
  }
});

await chatClient.connect();

// Connect to local WS server
const wss = new WebSocketServer({ port: 1949 });

wss.on("connection", (ws) => {
  ws.on("message", async (data) => {
    console.log("received", data.toString());

    let d = JSON.parse(data.toString());

    switch (d.event) {
      case "beginIntermission": {
        isRoundInProgress = false;
        isRoundIntermission = true;

        // if someone manages to !play before the map launches
        if (playersQueuedForRound.length > 0) {
          ws.send(
            JSON.stringify({
              event: "catchup",
              players: playersQueuedForRound,
            })
          );
        }
        break;
      }

      case "beginRound": {
        isRoundIntermission = false;
        isRoundInProgress = true;

        playersQueuedForRound = [];
        break;
      }

      case "updateOBSPrimaryText": {
        await obs.call("SetInputSettings", {
          inputName: process.env.OBS_PRIMARY_TEXT_SOURCE!,
          inputSettings: {
            text: d.text,
          },
        });

        break;
      }

      case "updateOBSSecondaryText": {
        await obs.call("SetInputSettings", {
          inputName: process.env.OBS_SECONDARY_TEXT_SOURCE!,
          inputSettings: {
            text: d.text,
          },
        });

        break;
      }
    }
  });
});
