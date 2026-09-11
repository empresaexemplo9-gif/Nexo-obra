#!/usr/bin/env node
// Gera a chave de cifra das fotos do diário (MEDIA_ENCRYPTION_KEY): 32 bytes aleatórios
// em base64. Configure o valor no painel de publicação, nunca no repositório.
//
// Trocar a chave torna ilegíveis as fotos já gravadas — os registros em texto continuam
// intactos, mas as imagens antigas não abrem mais. Guarde-a como guarda uma senha.

import { randomBytes } from "node:crypto";

console.log(randomBytes(32).toString("base64"));
