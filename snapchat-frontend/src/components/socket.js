import io from "socket.io-client";

const socket = io("https://snapchatclone.onrender.com", {
  transports: ["websocket", "polling"],
  upgrade: false
});

export default socket;
