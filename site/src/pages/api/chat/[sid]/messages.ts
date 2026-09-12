import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { forwardChat } from '../../../../lib/chat-proxy';
export const prerender = false;
export const ALL: APIRoute = ({ request }) => forwardChat(request, env);
