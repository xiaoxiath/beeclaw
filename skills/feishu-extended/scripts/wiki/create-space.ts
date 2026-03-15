#!/usr/bin/env bun
/**
 * Feishu Wiki Create Space
 *
 * Usage: bun scripts/wiki/create-space.ts <space-name>
 */

import { Client } from '@larksuiteoapi/node-sdk';

const client = new Client({
  appId: process.env.LARK_BEECLAW_APPID!,
  appSecret: process.env.LARK_BEECLAW_AS!,
});

async function createWikiSpace(name: string) {
  try {
    const response = await client.wiki.spaceWiki.create({
      data: {
        title: name,
      },
    });

    if (response.code !== 0) {
      console.error(JSON.stringify({
        success: false,
        error: response.msg,
        code: response.code,
      }));
      process.exit(1);
    }

    console.log(JSON.stringify({
      success: true,
      data: {
        space_id: response.data?.space?.space_id,
        space_name: response.data?.space?.name,
        url: response.data?.space?.url,
      },
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }));
    process.exit(1);
  }
}

const spaceName = process.argv[2];
if (!spaceName) {
  console.error(JSON.stringify({
    success: false,
    error: 'Space name is required',
    usage: 'bun scripts/wiki/create-space.ts <space-name>',
  }));
  process.exit(1);
}

createWikiSpace(spaceName);
