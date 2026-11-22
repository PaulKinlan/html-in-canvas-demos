# Writing: what generated text looks like, and how Paul writes

The site is Paul Kinlan's and its copy should read as his. This document has two lists. The first is the set of habits that make text read as written by a language model. The second describes how Paul writes, from his posts on [paul.kinlan.me](https://paul.kinlan.me/) and [aifoc.us](https://aifoc.us/), read on 2026-11-22. The short rules in [DESIGN.md](../DESIGN.md), "Writing rules", still apply. This is the long form of them.

`node tools/writing/check.mjs` (also `npm run check:writing`) flags the habits a script can find. Most of them can't be found by a script, so read a page against the first list before it goes out.

## Part 1: habits of generated text

Each one is marked **checked** if the script flags it, or **read** if a person has to look.

### Words

- **Words that sell and say nothing** (checked). delve, leverage, seamless, robust, powerful, magic, delight, effortless, unleash, supercharge, game-changing, cutting-edge, tapestry, testament, pivotal, streamline, showcase, elevate, unlock, harness, empower, plethora, myriad, utilise, facilitate, holistic, paradigm, vibrant, stunning. Say what the thing does and give the number.
- **Stock phrases** (checked). "it's worth noting", "it's important to note", "keep in mind that", "at its core", "when it comes to", "in today's", "in the world of", "let's dive in", "deep dive", "under the hood", "out of the box", "the power of", "a wide range of", "more than just", "not only X but also Y", "whether you're X or Y", "the best of both worlds", "just works", "that being said", "the key is", "the trick is", "think of it as".
- **Signpost adverbs at the start of a sentence** (checked). Importantly, Notably, Crucially, Essentially, Ultimately, Moreover, Furthermore, Additionally, Interestingly, Surprisingly, "Simply put", "In short", "In other words".
- **Filler and hedges** (checked, as a warning). "in order to", simply, basically, very, quite, truly, incredibly, arguably, "note that", "as mentioned", comprehensive, crucial, vital, essential, various, numerous, ensure. One "I think" from the author is fine. A hedge on every claim isn't.
- **Project words that crept in the same way** (checked). "the real DOM", "sharp edge". Earlier lists in DESIGN.md also name "the trick", "story", "sells", "headline", "lands", "on steroids".
- **Praise for the subject** (read). "elegant", "clean", "beautiful", "surprisingly simple", "nothing else on the web does this". If it is good, the demo shows it.

### Sentence shapes

- **"It's not X. It's Y."** (checked). Also "This isn't a screenshot: it's the element itself." Say what it is. Mention what it isn't only when a reader would otherwise assume it.
- **Paired phrases written for rhythm** (read). "One element, two places". "Drawn by the canvas, owned by the DOM". "Your content, their pixels". If the two halves are the same length and the sentence has no verb, it's this.
- **Lists of three written for rhythm** (read). "fast, flexible and fun", "clicks still land, focus still moves, text still selects". A list of three real things is fine. Three because three sounds finished is not. Check whether there were really two or four.
- **Runs of fragments** (checked, as a warning). "No library. No build step. No canvas code."
- **A question the writer answers at once** (checked for the common ones). "The result? It works." "Why does this matter?" Paul does ask questions in his own posts (see Part 2), but they are questions he doesn't know the answer to, or he answers with "Maybe".
- **A block that ends on a contrast** (checked, as a warning). "…, not a screenshot." Sometimes that is the fact. Often it's a flourish.
- **A closing line that restates the page as a moral** (read). "That is the whole idea in one small example." "And that's the point." End on the last fact.
- **Setting up, then revealing** (read). "Here's the thing:", "Here's where it gets interesting", "The catch?", "Enter `<dom-portal>`."
- **Every sentence the same length** (read). Generated prose settles at about 20 words a sentence with a balanced clause on each side of a comma. Vary it because the content varies, not on a pattern.
- **"X that Y and stays Z"** (read). "A card that bends and stays clickable." Once is a description. On every page it's a template.
- **Abstract subjects doing things** (read). "The demo explores…", "This page showcases…", "The API unlocks…". A person did it: "I built", "I measured". A thing does what it does: "The canvas draws".

### Structure

- **An opening that announces instead of starting** (read). "In this article we will look at…", "Let's take a look at…". Start with the thing.
- **An ending that summarises what was just said** (read). "In summary…", "Overall…", "To recap…".
- **An offer at the end** (read). "Let me know if you'd like…", "Feel free to…", "Happy coding".
- **The same skeleton on every page** (read). Each paragraph opening with the same phrase ("Five ideas from the element catalogue, built."), each section being a three-item list. This site has fixed section names on purpose ("How it works", "Live checks", "Findings"). The text inside them shouldn't be a form that was filled in.
- **Explaining what the reader was just told** (read). A heading, then a sentence that repeats the heading, then the content.
- **Symmetry** (read). Two options with exactly matching pros and cons, "on the one hand, on the other".

### Headings and formatting

- **Slogan headings** (checked for the common shapes). "One element, two places". "Forms, reimagined". "Meet `<dom-portal>`". A heading names the element, the call or the task.
- **Title Case Headings** (checked, as a warning). Use sentence case.
- **Question headings** (checked, as a warning). Fine when the section answers that question. Not as a hook.
- **Colon taglines** (read). "Portals: Where DOM Meets Canvas". A colon is fine when the second half is a plain description: "`<dom-portal>`: draw one element twice".
- **Em-dashes** (checked). None on this site. Use a full stop, a comma, a colon or brackets.
- **Bold on every list item** (read). "**Fast.** It is fast." Use bold where the reader has to find one line among many, which is rare.
- **Emoji as bullets or in headings** (checked, as a warning). None in copy. Demo content may have them.
- **Bullets where a sentence would do** (read). Three bullets of four words each are a sentence.
- **Exclamation marks** (checked in headings). Paul's posts have none.

### Tone

- **Marketing voice** (read). Anything that reads as if it wants the reader to be impressed. The site reports experiments, including the ones that failed.
- **Certainty that wasn't earned** (read). "This works everywhere." Say where it was measured, with the browser version and the date, and say "not verified" for the rest.
- **Hedging that wasn't needed** (read). "This may potentially help in some cases." If it was measured, say what was measured.
- **"We"** (checked, as a warning). One person runs this site. Say "I", or name who "we" is.
- **Talking about "the user" and "the developer"** (read). Say "you" to the person reading.
- **No person anywhere** (read). Passive constructions on every line ("it was found that", "the page was built to"). It hides who did the work.

## Part 2: how Paul writes

From eight posts: [ua-tracer](https://paul.kinlan.me/ua-tracer/), [The web the model sees](https://paul.kinlan.me/the-web-the-model-sees/), [Where my head is at with LLMs and the web](https://paul.kinlan.me/where-my-head-is-at-with-llms-and-the-web/), [AI Focus](https://paul.kinlan.me/2025-06-06-ai-focus/), [my chrome extensions are just prompts](https://aifoc.us/my-chrome-extensions-are-just-prompts/), [the browser is the sandbox](https://aifoc.us/the-browser-is-the-sandbox/), [dead framework theory](https://aifoc.us/dead-framework-theory/) and [this transition feels different](https://aifoc.us/transition/).

**First person, all the time.** "I" several times a paragraph. He says what he did and why: "So I built ua-tracer to answer it". "We" is for Chrome, a team or the industry, and he says which.

**He starts with how he got here.** A post opens on the thing that led to it, not on a definition: "I got hooked on Claude Code over the holiday break and used it to create a number of small projects in record time." "The work that led to this is a research project that I will soon publish on aifoc.us".

**A demo is introduced in one plain sentence.** "Co-do is an AI-powered file manager that runs entirely in the browser." "So how feasible is this to put into practice? Well, I built a demo." Then a picture, then a list of what it does.

**He says how sure he is.** "I think" comes before an opinion. "I'm not sure if I'm too happy about this." "I'm not confident that CSP alone prevents all network access." "I don't actually know if this is bad or good." It's one hedge, in his own voice, on the thing he is unsure about. It isn't a hedge on every sentence.

**He reports what failed in the same tone as what worked.** "it turns out that ChromeStatus.com is JS rendered". "It's not perfect, but the last 100 actions are kept". "It's a mitigation and not a solution". "I was wrong". His long posts have a "Known gaps" section.

**Contractions.** I'm, I've, it's, don't, can't, isn't, doesn't. Almost never "do not" or "it is".

**British spelling, mostly.** realised, organise, colour, virtualisation, flavours. Some -ize forms appear (customize). Use British spelling on the site.

**Sentences run about 15 to 22 words, with short ones between.** "That's it for me." "Permission fatigue is real." "Is it perfect? No." The short ones are there because he has a short thing to say.

**Asides in brackets.** "(to put it mildly)", "(hence this post to try and raise some awareness)", "It speeds things up a lot (from minutes per run to seconds in some cases)."

**Questions he hasn't answered.** "Could you build something like Cowork in the browser? Maybe." "Do we need better virtualisation?" These are open questions, which suits a site of experiments. He doesn't use a question to set up an answer he already has.

**Code is introduced with a colon and explained after.** "This is pretty much the whole UI for the Sorting Hat tab organiser example (trimmed a little):" then the listing, then what it does and what it bought him.

**Headings are sentence case and say what the section is.** "How it works", "What a trace looks like", "Try it", "Known gaps", "The double iframe technique", "Putting it into practice: Co-do".

**He talks to "you" and asks for feedback.** "Point a crawler at uatracer.com and you can see what yours does." "I'd love some feedback on this and if you have any other tests that you would like me to add."

**Informal words, used lightly.** kinda, btw, heaps, "Well,", "Anyway,", "So," at the start of a sentence. No exclamation marks and no emoji in prose.

**Endings are short.** "That's roughly where I am. There's still lots I will be exploring." He doesn't summarise.

### What not to copy

- The typos. His posts have them (they are written by hand, quickly). Don't add any.
- The slang, beyond a word here and there. "hella" and "OMG" belong to a blog post, not to a results table.
- The dashes. He uses a spaced hyphen as a dash and sometimes an em-dash. This site uses neither, at his request.
- Opinions he hasn't given. Write "I think" only for something he has said or that the page measured. Don't invent a view for him.

## Part 3: on this site

- **Titles** are his. Don't rename them.
- **A lede** says what the thing on the page is and what to do with it, in his voice. First person where he did something: "I wanted to know if…", "I built this to test…", "I couldn't get X to work, so…". Not "This page asks whether".
- **Findings** are facts with the browser version and the date. First person is right for a judgement ("I think this is a bug") and for the device ("on my phone, Chrome 159 on Android"). A measured result stays a plain statement: "A `<col>` has a box and no picture."
- **A `page.json` blurb** is also the description a shared link shows. One or two sentences that say what is on the page. No hook.
- **Contractions** in prose. Not in a results table cell that a script compares against.
- **"Not verified"** stays as it is. It is the site's term for something no check or person has run.
- **Say "you"** for the reader and "I" for Paul. "The test browser" is headless Chromium 157 in the cloud container. "My phone" is his Android phone.

### Before and after

| Before | After | What was wrong |
|---|---|---|
| "One element, drawn twice: click and type in either copy." | "`<dom-portal for="cart">` draws an element a second time somewhere else on the page. You can click and type in either one." | A paired phrase in place of a sentence |
| "It is not a clone or a screenshot: it is the same element drawn a second time." | "It's the same element, drawn a second time." | "Not X: Y" for effect |
| "No custom element, no library." | "This one has no custom element and no library." | A run of fragments |
| "`<canvas-slot effect="tilt">` and you are done: no render loop, no canvas code." | "Add `effect="tilt"` to `<canvas-slot>` and you don't write a render loop." | A sales line |
| "This page asks whether a canvas can draw a datalist." | "I wanted to know how much of a datalist a canvas can draw." | No person |
| "Every route we can think of for getting DOM out of its canvas" | "Every route I could think of for getting DOM out of its canvas" | "We" with nobody behind it |
| "The numbers are from this device, right now." | "The numbers are measured on your device when you press Run." | Emphasis in place of a fact |
