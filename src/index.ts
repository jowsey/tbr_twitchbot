import * as dotenv from "dotenv";
import { existsSync, writeFileSync } from "fs";

dotenv.config();

import tmi, { ChatUserstate } from "tmi.js";

import { WebSocketServer } from "ws";
import { PlayerDetails } from "./PlayerDetails.js";

if (!existsSync(".env")) {
  writeFileSync(".env", '# https://dev.twitch.tv/console\nBOT_USERNAME=""\nBOT_TOKEN=""\nCHANNEL_NAME=""');
  throw new Error("No .env file found - an empty file has been created, please fill it!");
}

const client = new tmi.client({
  identity: {
    username: process.env.BOT_USERNAME,
    password: "oauth:" + process.env.BOT_TOKEN,
  },
  channels: [process.env.CHANNEL_NAME!],
});

client.on("connected", (address: string, port: number) => {
  console.log("Connected to " + address + ":" + port + " as " + client.getUsername());
});

let isRoundIntermission = true;
let isRoundInProgress = false;

let playersQueuedForRound: PlayerDetails[] = [];

client.on("message", async (channel: string, user: ChatUserstate, message: string, self: boolean) => {
  if (self) return;

  if (
    (isRoundIntermission || isRoundInProgress) &&
    (message.toLowerCase() === "!play" || message.toLowerCase() === "play" || message.toLowerCase() === "! play")
  ) {
    if (playersQueuedForRound.map((p) => p.name).includes(user.username!)) {
      if (isRoundIntermission) {
        await client.say(channel, `@${user.username} already in this round cmonBruh`);
      } else if (isRoundInProgress) {
        await client.say(channel, `@${user.username} already queued for next round cmonBruh`);
      }
    } else {
      if (isRoundIntermission) {
        await client.say(channel, `@${user.username} joining this round :)`);
      } else if (isRoundInProgress) {
        await client.say(channel, `@${user.username} joining next round ResidentSleeper`);
      }

      playersQueuedForRound.push({
        name: user.username!,
        userId: user["user-id"]!,
        color: user.color!,
      });
    }
  }
});

const wss = new WebSocketServer({ port: 1949 });

wss.on("connection", (ws) => {
  ws.on("message", (data) => {
    console.log("recieved", data.toString());

    let d = JSON.parse(data.toString());
    if (d.event == "beginIntermission") {
      isRoundInProgress = false;
      isRoundIntermission = true;
    }

    if (d.event == "beginRound") {
      isRoundIntermission = false;
      isRoundInProgress = true;

      console.log("sending lobby of", playersQueuedForRound.length, "players to game");
      ws.send(
        JSON.stringify({
          event: "lobby",
          users: playersQueuedForRound,
        })
      );

      playersQueuedForRound = [];
    }
  });
});

await client.connect();
