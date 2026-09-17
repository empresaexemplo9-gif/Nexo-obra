#!/usr/bin/env node
// Gera a chave de cifra das credenciais guardadas no banco (SECRETS_ENCRYPTION_KEY):
// 32 bytes aleatórios em base64. Configure o valor no painel de publicação, nunca no
// repositório.
//
// É separada da chave das fotos de propósito: uma protege imagem, a outra protege
// credencial de acesso a dinheiro. Compartilhar amarraria a rotação de uma à outra.
//
// Trocar a chave torna ilegíveis as credenciais já guardadas — as empresas conectadas
// precisam reconectar. Guarde-a como guarda uma senha.

import { randomBytes } from "node:crypto";

console.log(randomBytes(32).toString("base64"));
