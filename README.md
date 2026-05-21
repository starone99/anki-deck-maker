# Anki Deck Maker

**https://starone99.github.io/anki-deck-maker**

A static web app for creating personalized Anki flashcard decks from Japanese example sentences.

## Features

- Input example sentences with a target word — the word is **highlighted** automatically
- Auto-generates readings (furigana) from sentence context using [Kuromoji.js](https://github.com/takuyaa/kuromoji.js)
- Manual reading override
- Tag and deck name support with autocomplete from history
- Session auto-save via localStorage — cards persist across browser sessions
- Export as CSV for Anki import
- English / 한국어 UI toggle

## Usage

1. Enter a **deck name**
2. Fill in the **sentence**, **target word**, **reading**, and **meaning**
3. Add tags if needed
4. Click **Add Card** — repeat for each word
5. Click **Export CSV** and import the file into Anki

> In Anki: File → Import → select the downloaded CSV

## Card Format

| Side | Content |
|------|---------|
| Front | Example sentence with target word **bolded** |
| Back | Word [reading] + meaning |

## Running Locally

Just open `index.html` in a browser. No build step or server required.

## Deployment

Push to a GitHub repository and enable GitHub Pages (Settings → Pages → Deploy from branch).
