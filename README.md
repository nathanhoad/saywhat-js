# SayWhat

A JavaScript runtime for [SayWhat](https://nathanhoad.itch.io/saywhat) JSON exports.

## Usage

`npm i @nathanhoad/saywhat`

```ts
import DialogueManager from "@nathanhoad/saywhat";
// Import your dialogue resource (make sure JSON imports are available to your build)
import DialogueResource from "./dialogue.json";

// Set up any game states if you need them (game states are objects with properties and functions on them that the dialogue can use)
DialogueManager.gameStates = [{
    someVariable: true,
    someCounter: 0,
    someFunction() {
        return someCounter * someCounter;
    }
}];

// Get the next printable line of dialogue
let line = await DialogueManager.getNextDialogueLine("Some title from the dialogue", DialogueResource);
console.log(line); // line contains "character", "dialogue", "responses", and "nextId"
line = await DialogueManager.getNextDialogueLine(line.nextId, DialogueResource);
```

## GameStates, Conditions, and Mutations

If, in your dialogue you have something like this:

```
# Some title

Character: Hello
if someVariable == true
    set someCounter += 1
    Character: someCounter squared is {{someFunction()}}.
Character: Wow.
```

Then you need to define a game state that contains the properties `someVariable`, `someCounter`, and a function `someFunction` that takes no arguments and returns a value.

## Author

- [Nathan Hoad](https://github.com/nathanhoad)