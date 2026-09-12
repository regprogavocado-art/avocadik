import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {publicManifestResponse} from '../../../lib/public-manifest';

export const prerender=false;
export const GET:APIRoute=()=>publicManifestResponse(env);
