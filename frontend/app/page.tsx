"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
import ChatWithAI from "./chat/page";

interface ChatMessage {
  type: string;
  messages: [string];
}

export default function Home() {
  const [inputVal, setInputVal] = useState<string>("");
  const [chats, setChats] = useState<ChatMessage[]>([]);

  const handleChatSend = async () => {
    if (!inputVal.trim()) return;

    const response = await fetch("http://localhost:8000/api/v1/chats", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "user",
        message: inputVal,
      }),
    });

    const newChat = await response.json();

    setChats((prevChats) => [...prevChats, newChat]);

    setInputVal("");
  };

  useEffect(() => {
    const load = async () => {
      const data = await fetch("http://localhost:8000/api/v1/chats");
      const chats = await data.json();
      setChats(chats);
      console.log(chats);
    };
    load();
  }, []);
  return (
    <ChatWithAI />
  );
}
