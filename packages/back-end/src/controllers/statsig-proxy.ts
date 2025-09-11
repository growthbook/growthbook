import { Request, Response } from "express";
import { AuthRequest } from "../types/AuthRequest";

export const statsigProxy = async (req: AuthRequest, res: Response) => {
  try {
    const { endpoint, apiKey, method = 'GET', body } = req.body as { 
      endpoint: string; 
      apiKey: string; 
      method?: string;
      body?: any;
    };

    if (!endpoint || !apiKey) {
      return res.status(400).json({ error: "Missing endpoint or apiKey" });
    }

    const url = `https://statsigapi.net/console/v1/${endpoint}`;

    const fetchOptions: RequestInit = {
      method,
      headers: {
        'STATSIG-API-KEY': apiKey,
        'STATSIG-API-VERSION': '20240601',
        'Content-Type': 'application/json',
      },
    };

    // Add body for POST requests
    if (method === 'POST' && body) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`StatSig Console API error (${url}): ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("StatSig proxy error:", error);
    res.status(500).json({ error: error.message });
  }
};
