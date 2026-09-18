CREATE TABLE `parametro_fontes` (
	`id` text PRIMARY KEY NOT NULL,
	`assinatura` text,
	`estado` text,
	`detalhe` text,
	`conferido_em` integer,
	`revisado_em` integer,
	`revisado_por` text
);
