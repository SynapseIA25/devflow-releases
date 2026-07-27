# DevFlow — Ideas de monetización (documento base para investigación)

> Consolidado 2026-07-27 a partir de varias sesiones de trabajo (2026-07-09 a 2026-07-26). No es un
> plan cerrado: es la base para investigar antes de decidir nada nuevo. Lo único ya **decidido** está
> marcado explícitamente como tal — todo lo demás es idea abierta.

---

## 1. Estado actual (lo único decidido)

**Decisión tomada el 2026-07-17**: lanzar DevFlow **gratis, BYO-key** (bring your own key) ahora
mismo, y evaluar **freemium + Pro por licencia** más adelante, cuando haya tracción real de usuarios.

- Hoy: el usuario pega su propia API key (OpenRouter/Gemini/Groq/Mistral) en Settings, o usa los
  modelos gratis que trae DevFlow Code (OpenCode Zen) sin configurar nada. Cero backend propio, cero
  facturación.
- Infraestructura de distribución ya está lista: releases automáticos firmados para Windows/macOS
  (x64+arm64)/Linux (deb+rpm), auto-updater, landing page, instalación por curl.
- **Pendiente sin resolver todavía**: qué entra concretamente en un futuro plan "Pro". Nunca se
  definió una lista de features.

Este documento junta las ideas que están **más allá** de esta decisión ya tomada — cosas para
investigar antes de encarar cualquiera.

---

## 2. Mapa de las 5 rutas de monetización identificadas

| # | Ruta | Fricción para el usuario | Complejidad para nosotros | Estado |
|---|---|---|---|---|
| 1 | **Open-source gratis BYO-key** | Media (necesita conseguir su propia key) | Baja | ✅ Es la ruta activa hoy |
| 2 | **Freemium + Pro por licencia** | Baja | Media | Decidido como "próximo paso", sin definir features |
| 3 | **Inferencia gestionada / propia (usage-based)** | Mínima (sin key propia) | Alta (backend + billing + anti-abuso) | Investigada en profundidad, sin decidir — sección 3 |
| 4 | **Team / Enterprise** (workspaces cooperativos, SSO, soporte) | Baja para el equipo | Muy alta (cambio de arquitectura) | Idea nueva sin explorar — sección 4 |
| 5 | **Marketplace** (workflows/agentes/MCP con revenue-share) | — | — | Etapa tardía, no evaluada todavía |

Camino sugerido en su momento (no descartado, solo no ejecutado): arrancar con 1/2 para validar
adopción, migrar a 3 cuando haya tracción. Las rutas 3 y 4 son las dos que el usuario quiere retomar
con más detalle — quedan desarrolladas abajo.

---

## 3. Ruta 3 — Inferencia gestionada / propia

### 3.1 Dos variantes con economía MUY distinta (distinción clave, no confundirlas)

1. **Revender el producto serverless-por-token de un proveedor grande** (AWS Bedrock, GCP Vertex Model
   Garden, etc.): ellos ya cobran con su margen incluido. Para tener margen propio hay que cobrar más,
   compitiendo directo contra Together AI / Groq / Fireworks / DeepInfra, que operan a escala masiva
   con mejor precio unitario. **Sin ventaja real** frente a simplemente revender OpenRouter (que ya es
   básicamente esto).
2. **Correr un stack propio (vLLM/TGI) sobre GPU serverless que escala a cero** (RunPod serverless,
   Modal, o contenedores custom en GCP Vertex/AWS SageMaker): acá se paga por segundo de cómputo real,
   no un precio-por-token fijo del proveedor — el margen depende de qué tan bien se optimice el
   serving propio. Es la única variante con arbitraje real. Es, en los hechos, "montar tu propio
   Together AI".

### 3.2 Idea concreta nueva (2026-07-26): GCP + modelos open-weight (deepseek, kimi k3)

Es la variante #2 de arriba, con proveedor e modelos concretos: servidores GCP pagados por tiempo de
uso, corriendo deepseek y/o kimi k3, ofreciendo una cuota de uso a los usuarios de DevFlow.

**Riesgo principal identificado**: el costo de GPU-hora de un modelo tamaño deepseek/k3 es alto, y si
la demanda no es constante se quema plata en capacidad ociosa — el problema clásico de dedicar
infraestructura sin volumen probado.

**Secuencia recomendada** (no ejecutada, para validar antes de invertir en GPU propia):
1. Primero revender con margen sobre un proveedor existente (mismo mecanismo que ya usa el router de
   modelos de DevFlow vía OpenRouter) para validar que la gente efectivamente paga por una cuota.
2. Recién considerar GCP propio cuando el volumen mensual justifique el costo fijo de GPU (ver modelo
   matemático abajo — es literalmente la pregunta que ese modelo responde).

### 3.3 Modelo matemático de rentabilidad (ya derivado, listo para aplicar con números reales)

Instancia dedicada vs. serverless pay-per-token:

- **`V = C_D / C_S`** — volumen mensual (en millones de tokens) a partir del cual conviene una
  instancia dedicada por sobre serverless. `C_D` = costo fijo mensual de la instancia dedicada. `C_S`
  = costo serverless por millón de tokens.
- **Restricción de capacidad**: `L_max = S × 2,592,000 × U` — `S` = tokens/segundo que rinde la GPU
  elegida, `U` = factor de utilización real (nunca 100%). `2,592,000` = segundos en 30 días.
- Si el volumen proyectado `V` supera `L_max`, una sola GPU no alcanza y hay que recalcular con una
  segunda instancia — por eso serverless domina por defecto hasta tener tráfico estable y medido.

**Para investigar**: conseguir números reales de (a) costo por hora de instancias GPU en GCP capaces
de correr deepseek/kimi k3 a una tasa de tokens/seg aceptable, (b) precio serverless equivalente vía
OpenRouter/Together/etc. para los mismos modelos, (c) una proyección realista de volumen de DevFlow
con la base de usuarios actual — para poder calcular `V` y `L_max` con datos reales en vez de teóricos.

### 3.4 Arquitectura de cobro por uso (ya diseñada, no implementada)

- **Flujo**: API Gateway (Kong / AWS API Gateway) valida la API key del usuario → el backend cuenta
  tokens de entrada/salida de cada request → reporta el consumo a **Stripe Meter Events** (metered
  billing) → Stripe factura automáticamente cada mes. Identidad: 1 API key ↔ 1 customer de Stripe.
- **Protección anti-abuso, 3 capas** (necesaria porque el costo por request varía muchísimo con LLMs,
  a diferencia de una API REST normal):
  1. **Gateway (rate limiting por RPS)**: evita saturar el servidor, pero NO controla el costo real en
     tokens (un request corto y uno larguísimo cuentan igual a nivel RPS).
  2. **Backend + Redis — control de costo real**: algoritmo **Token Bucket** ejecutado como **script
     Lua atómico en Redis** (evita race conditions sin necesidad de locks). Mecanismo de "peaje
     preventivo": se reserva `prompt_tokens + max_tokens` ANTES de llamar al LLM; si el saldo no
     alcanza, se devuelve 429. Al terminar la inferencia se **reembolsa** la diferencia entre lo
     reservado y el uso real, con un segundo script Lua (reembolso = 100% si el proveedor falla;
     reembolso = 0 si la respuesta se cortó por `finish_reason: length`, ya que ahí sí se consumió el
     máximo reservado).
  3. **Stripe — kill switch financiero**: límite de gasto mensual configurable por cliente, alerta al
     95% de uso, desactivación automática de la API key al 100%.

Los dos scripts Lua completos (reserva + reembolso) se diseñaron en detalle en la sesión del
2026-07-21 — no están en este documento por espacio, pero están disponibles si se retoma esta ruta en
serio (quedaron en el historial de esa conversación).

### 3.5 Legal / cumplimiento (sin resolver, hay que revisar antes de avanzar)

- Revisar los Términos de Servicio de OpenRouter (y de cualquier proveedor que se use) respecto a
  **reventa** de acceso — no está claro si el modelo de "cuota a usuarios finales" está permitido tal
  cual.
- Nunca distribuir credenciales propias de otros CLIs/agentes (ej. no se puede shippear una sesión de
  MiMo, cada usuario necesita la suya).
- Revisar las políticas de uso específicas de cada modelo que se piense servir (deepseek, kimi k3
  incluidos) — licencias open-weight no siempre son irrestrictas para uso comercial a escala.

---

## 4. Ruta 4 — Workspaces cooperativos + chat estilo Slack (Team/Enterprise)

### 4.1 La idea (2026-07-26)

Espacios de trabajo cooperativos y chat compartido dentro de la app, al estilo Slack, para que equipos
u organizaciones usen DevFlow juntos (no un usuario aislado en su máquina).

### 4.2 Por qué esto NO es una feature incremental

DevFlow hoy es **local-first**: un usuario, una máquina, sin backend, sin concepto de identidad más
allá de lo que vive en el disco local (localStorage/Zustand persistido). Meterle multi-usuario,
tiempo real y organizaciones implica sumar:

- Un **backend cloud** que hoy no existe en absoluto (autenticación, autorización, persistencia
  compartida).
- **Presencia y sincronización en tiempo real** entre varios clientes viendo el mismo estado.
- Un modelo de **identidad de organización/equipo** (hoy no hay ni siquiera un concepto de "usuario"
  más allá de la instalación local).

Es un cambio de arquitectura de fondo, no algo que se pueda colar dentro de otra feature — necesita
ser una decisión explícita y aislada: **"¿DevFlow deja de ser local-first?"**, separada de cualquier
otro trabajo en curso.

### 4.3 Para investigar si se retoma esta ruta

- Qué tan real es la demanda de "equipo" antes de invertir en backend — encaja con la misma lógica de
  "validar antes de construir" que la ruta 3.
- Alternativas de menor compromiso arquitectónico: ¿sync opcional (como un Git remoto) en vez de
  tiempo real completo? ¿Compartir solo ciertos artefactos (workflows, skills — que YA tienen un
  sistema de compartición, ver memoria de Skills) en vez de todo el estado de la app?
- Costo de mantener DOS modos (local-first puro + modo colaborativo) vs. migrar todo a cloud-backed.
- Quién sería el target real: ¿equipos chicos que ya usan Slack/Discord y no quieren un chat más? ¿O
  el valor está en compartir *contexto de proyecto* (workflows, deuda técnica, memoria) más que en el
  chat en sí?

---

## 5. Pendiente de la decisión ya tomada: features Pro

Sigue sin definirse. Candidatos mencionados en sesiones anteriores (nunca evaluados en profundidad):
equipo de expertos (multi-agente), ambientes de prueba (worktrees), router de modelos premium. Esto
es más chico que las rutas 3/4 pero es el "próximo paso" que quedó pendiente desde el 2026-07-17 —
vale la pena resolverlo aunque sea en paralelo a investigar las ideas más grandes.

---

## 6. Preguntas abiertas para la investigación

1. **Ruta 3**: ¿cuáles son los precios reales de GPU en GCP para deepseek/kimi k3 a una tasa de
   tokens/seg usable? ¿Cuál sería el volumen de tokens/mes esperado con la base de usuarios actual de
   DevFlow (para aplicar `V = C_D / C_S`)? ¿Qué dicen los ToS de OpenRouter sobre reventa?
2. **Ruta 4**: ¿hay señal real de demanda de equipo/organización, o es una hipótesis sin validar?
   ¿Existe una versión de menor compromiso (sync de artefactos puntuales) antes de ir a "cloud
   completo"?
3. **Ruta 2**: ¿qué features concretas justifican un plan Pro, dado lo que ya está construido
   (Test Strategy Advisor, equipo de expertos, ambientes, router de modelos)?
4. Transversal: ¿cuál de las cuatro (2, 3, 4, o seguir puliendo la 1) tiene el mejor ratio
   esfuerzo/impacto dado el estado actual de tracción (todavía sin usuarios reales más allá de
   dogfooding propio)?

---

## Referencias

- Historial completo y decisiones cronológicas: memoria `devflow-distribucion-monetizacion`.
- Ideación original de las dos ideas nuevas (GCP+modelos, workspaces): memoria
  `devflow-distribucion-monetizacion`, sección "IDEACIÓN 2026-07-26".
- Estado de la plataforma / features ya construidas: memoria `devflow-plataforma-roadmap` y
  `project-devflow`.
