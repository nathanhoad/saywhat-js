const TYPE_CONDITION = "condition";
const TYPE_DIALOGUE = "dialogue";
const TYPE_MUTATION = "mutation";
const TYPE_RESPONSE = "response";
const TYPE_GOTO = "goto";

const TYPE_FUNCTION = "function";
const TYPE_SCALAR = "scalar";
const TYPE_ERROR = "error";


type DialogueResource = {
    titles: Record<string, string>;
    lines: Record<string, LineData>;
}
type LineData = {
    type: string;
    next_id: string;
    next_conditional_id?: string;
    next_id_after?: string;
    character?: string;
    text?: string;
    condition?: Condition;
    mutation?: Mutation;
    replacements?: Array<Replacement>;
    responses?: Array<string>;
}
type Condition = {
    lhs_type: string;
    lhs_function?: string;
    lhs_args?: Array<any>;
    lhs?: any;
    operator?: string;
    rhs_type?: string;
    rhs_function?: string;
    rhs_args?: Array<any>;
    rhs?: any;
}
type Mutation = {
    lhs_type: string;
    lhs_function?: string;
    lhs_args?: Array<any>;
    lhs?: any;
    operator?: string;
    rhs_type?: string;
    rhs_function?: string;
    rhs_args?: Array<any>;
    rhs?: any;
}
type Replacement = {
    type: string;
    value: any;
    value_in_text: string;
    function?: string;
    args?: Array<any>;
}


class DialogueManager {
    isStrict: boolean = true;

    defaultResource: DialogueResource;
    gameStates: Array<any> = [];

    private _internalState: any = {};
    private isDialogueRunning: boolean = false;
    private listeners: Record<"started" | "finished", Array<() => {}>> = {
        "started": [],
        "finished": []
    }

    /**
     * Add a listener for when dialogue has started or finished
     * @param type "started" or "finished"
     * @param fn 
     */
    public addListener(type: "started" | "finished", fn: () => {}): void {
        this.listeners[type].push(fn);
    }

    /**
     * Remove a listener
     * @param type "started" or "finished"
     * @param fn 
     */
    public removeListener(type: "started" | "finished", fn: () => {}): void {
        this.listeners[type] = this.listeners[type].filter(l => l !== fn);
    }

    /**
     * Step through lines and run any mutations until we either 
     * hit some dialogue or the end of the conversation.
     * @param key The key of the entry point into the dialogue
     * @param overrideResource A local dialogue resource to use instead of the default one
     * @returns The first line of dialogue that is printable
     */
    public async getNextDialogueLine(key: string, overrideResource: DialogueResource = null): Promise<DialogueLine> {
        // You have to provide a dialogue resource
        if (this.defaultResource == null && overrideResource == null) throw new Error("No dialogue resource provided");

        const localResource = overrideResource ?? this.defaultResource;

        const dialogue = this.getLine(key, localResource)

        this.setIsDialogueRunning(true);

        // If our dialogue is nothing then we hit the end
        if (dialogue == null || !this.isValid(dialogue)) {
            this.setIsDialogueRunning(false);
            return null;
        }

        // Run the mutation if it is one
        if (dialogue.type == TYPE_MUTATION) {
            await this.mutate(dialogue.mutation);
            if (dialogue.nextId != "") {
                return this.getNextDialogueLine(dialogue.nextId, localResource);
            } else {
                // End the conversation
                this.setIsDialogueRunning(false);
                return null;
            }
        } else {
            return dialogue;
        }
    }

    /**
     * Set if the dialogue is currently running
     * @param value 
     */
    setIsDialogueRunning(value: boolean): void {
        if (value !== this.isDialogueRunning) {
            if (value) {
                this.listeners["started"].forEach(fn => fn());
            } else {
                this.listeners["finished"].forEach(fn => fn());
            }
        }
        this.isDialogueRunning = value;
    }

    /**
     * Get a line by its key
     * @param key A line key
     * @param localResource A local dialogue resource to use instead of the default one.
     * @returns The first line that passes any conditions
     */
    protected getLine(key: string, localResource: DialogueResource = null): DialogueLine {
        // See if it is a title
        key = localResource.titles[key] ?? key;

        // End of conversation probably
        if (!localResource.lines[key]) {
            return null;
        }

        const data = localResource.lines[key];

        // Check condtiions
        if (data.type == TYPE_CONDITION) {
            // "else" will have no actual condition
            if (data.condition == null || this.check(data.condition)) {
                return this.getLine(data.next_id, localResource);
            } else {
                return this.getLine(data.next_conditional_id, localResource);
            }
        }

        // Evaluate early exits
        if (data.type == TYPE_GOTO) {
            return this.getLine(data.next_id, localResource);
        }

        // Set up a line object
        const line = new DialogueLine(data);

        // Only responses
        if (data.type == TYPE_RESPONSE) {
            line.responses = this.getResponses(data.responses, localResource);
            return line;
        }

        // Replace any variables in the dialogue text
        if (data.type == TYPE_DIALOGUE && data.replacements) {
            line.dialogue = this.getReplacements(line.dialogue, data.replacements);
        }

        // Inject the next node's responses if they have any
        const nextLine = localResource.lines[line.nextId];
        if (nextLine != null && nextLine.type == TYPE_RESPONSE) {
            line.responses = this.getResponses(nextLine.responses, localResource);
            // If there is only one response then it has to point to the next node
            if (line.responses.length == 1) {
                line.nextId = line.responses[0].nextId;
            }
        } else {
            line.responses = [];
        }

        return line;
    }

    /**
     * Check if a condition is met
     * @param condition A condition object to check against
     * @returns True if the condition passes (or there was no condition)
     */
    check(condition: Condition): boolean {
        if (!condition) return true;

        // Evaulate left hand side
        let lhs;
        switch (condition.lhs_type) {
            case TYPE_FUNCTION:
                lhs = this.getStateFunctionValue(condition.lhs_function, condition.lhs_args);
                break;
            case TYPE_SCALAR:
                lhs = this.getStateValue(condition.lhs);
                break;
            case TYPE_ERROR:
                throw new Error("This condition was not exported properly");
        }

        // If there is no operator then we just return the value of the lhs
        if (!condition.operator) {
            return Boolean(lhs);
        }

        // Evaluate right hand side
        let rhs;
        switch (condition.rhs_type) {
            case TYPE_FUNCTION:
                rhs = this.getStateFunctionValue(condition.rhs_function, condition.rhs_args);
                break;
            case TYPE_SCALAR:
                rhs = this.resolve(condition.rhs);
                break;
            case TYPE_ERROR:
                throw new Error("This condition was not exported properly");
        }

        switch (condition.operator) {
            case "=":
            case "==":
                return lhs == rhs;
            case ">":
                return lhs > rhs;
            case ">=":
                return lhs >= rhs;
            case "<":
                return lhs < rhs;
            case "<=":
                return lhs <= rhs;
            case "<>":
            case "!=":
                return lhs != rhs;
            case "in":
                return lhs in rhs;
        }

        return false;
    }

    /**
     * Make a change to game state or run a method
     * @param mutation The mutation object to run
     * @returns A promise of the running mutation
     */
    async mutate(mutation: Mutation): Promise<void> {
        if (!mutation) return;

        // Evaulate left hand side
        let lhs;
        switch (mutation.lhs_type) {
            case TYPE_FUNCTION:
                // If lhs is a function then we run it and return because you can't assign to a function
                const function_name = mutation.lhs_function
                const args = this.parseArgs(mutation.lhs_args);

                switch (function_name) {
                    case "wait":
                        return new Promise((resolve) => {
                            setTimeout(() => resolve(), parseFloat(args[0]));
                        });

                    case "debug":
                        const printable = mutation.lhs_args.reduce((o, arg, index) => {
                            o[arg] = args[index];
                        }, {});
                        console.log(printable);

                    default:
                        let found = false
                        for (const state of this.gameStates) {
                            if (typeof state[function_name] === "function") {
                                found = true;
                                await state[function_name](...args);
                            }
                        }
                        if (!found) {
                            if (this.isStrict) {
                                throw new Error("'" + function_name + "' is not a method on any game state");
                            } else {
                                return;
                            }
                        }
                }
                return;

            case TYPE_SCALAR:
                // lhs is the name of a state property
                lhs = mutation.lhs;
                break;

            case TYPE_ERROR:
                throw new Error("This mutation was not exported properly");
        }

        // If there is no operator then we don't do anything
        if (!mutation.operator) {
            return;
        }

        // Evaluate right hand side
        let rhs;
        switch (mutation.rhs_type) {
            case TYPE_FUNCTION:
                rhs = this.getStateFunctionValue(mutation.rhs_function, mutation.rhs_args)
                break;
            case TYPE_SCALAR:
                rhs = this.resolve(mutation.rhs);
                break;
            case TYPE_ERROR:
                throw new Error("This condition was not exported properly");
        }

        switch (mutation.operator) {
            case "=":
                this.setStateValue(lhs, rhs);
                break;
            case "+=":
                this.setStateValue(lhs, this.getStateValue(lhs, typeof rhs) + rhs);
                break;
            case "-=":
                this.setStateValue(lhs, this.getStateValue(lhs, typeof rhs) - rhs);
                break;
            case "*=":
                this.setStateValue(lhs, this.getStateValue(lhs, typeof rhs) * rhs);
                break;
            case "/=":
                this.setStateValue(lhs, this.getStateValue(lhs, typeof rhs) / rhs);
                break;
        }
    }

    /**
     * Replace any variables, etc in the dialogue with their state values
     * @param text The initial text
     * @param replacements A list of things to replace
     * @returns The text with replacements replaced
     */
    getReplacements(text: string, replacements: Array<Replacement>): string {
        for (const replacement of replacements) {
            let value = "";
            switch (replacement.type) {
                case TYPE_FUNCTION:
                    value = this.getStateFunctionValue(replacement.function, replacement.args);
                    break;
                case TYPE_SCALAR:
                    value = this.resolve(replacement.value);
                    break;
            }
            text = text.replace(replacement.value_in_text, value);
        }
        return text;
    }


    /**
     * Replace an array of line keys with their response prompts
     * @param keys A list of line keys
     * @param localResource A local resource to override the default one
     * @returns A list of DialogueResponses
     */
    getResponses(keys: Array<string>, localResource: DialogueResource): Array<DialogueResponse> {
        const responses: Array<DialogueResponse> = []
        for (const key of keys) {
            const data = localResource.lines[key];
            if (data.condition == null || this.check(data.condition)) {
                const response = new DialogueResponse(data);
                responses.push(response)
            }
        }

        return responses
    }

    /**
     * Get a value on the current scene or game state
     * @param arg A value
     * @returns The resolved value
     */
    getStateValue(arg: any, typeHint: string = "boolean"): any {
        if (["number", "boolean"].indexOf(typeof arg) > -1) {
            return arg;
        }

        if (arg.match(/^".*"$/)) {
            // A literal string
            return arg.replace(/^"/, "").replace(/"$/, "");
        } else if (arg.toLowerCase() === "true" || arg.toLowerCase() === "yes") {
            // True
            return true;
        } else if (arg.toLowerCase() === "false" || arg.toLowerCase() === "no") {
            // False
            return false;
        } else if (parseInt(arg, 10).toString() === arg) {
            // An integer
            return parseInt(arg, 10);
        } else if (parseFloat(arg).toString() === arg) {
            // A float
            return parseFloat(arg);
        } else {
            // It's a variable
            for (const state of this.gameStates) {
                if (typeof state[arg] !== "undefined") {
                    return state[arg];
                }
            }
            if (this.isStrict) {
                throw new Error("'" + arg + "' is not a property on any game state");
            } else if (typeof this._internalState[arg] !== "undefined") {
                return this._internalState[arg];
            } else {
                // Guess an initial value based on the type hint
                switch (typeHint) {
                    case "number":
                        if (arg.toString().indexOf(".") > -1) {
                            return 0.0
                        } else {
                            return 0;
                        }
                    case "string":
                        return "";
                    default:
                        return false;
                }
            }
        }
    }

    /**
     * Set a value on the current scene or game state
     * @param property A property name
     * @param value The new value
     * @returns 
     */
    setStateValue(property: string, value: any): void {
        for (const state of this.gameStates) {
            if (typeof state[property] !== "undefined") {
                state.set(property, value);
                return;
            }
        }
        if (this.isStrict) {
            throw new Error("'" + property + "' is not a property on any game state");
        } else {
            this._internalState[property] = value;
        }
    }

    /**
     * Get the value of a state function
     * @param functionName The name of a function
     * @param args The arguments
     * @returns The resolved value of running the function
     */
    getStateFunctionValue(functionName: string, args: Array<string>): any {
        args = this.parseArgs(args);

        for (const state of this.gameStates) {
            if (typeof state[functionName] === "function") {
                return state[functionName](...args);
            }
        }

        if (this.isStrict) {
            throw new Error("'" + functionName + "' is not a method on any game state");
        } else {
            return false;
        }
    }

    /**
     * Evaluate an array of args from their state values
     * @param args A list of arguments
     * @returns A resolved list of those arguments
     */
    parseArgs(args: Array<any>): Array<any> {
        let nextArgs = [];
        for (let i = 0; i < args.length; i++) {
            nextArgs.push(this.getStateValue(args[i]));
        }
        return nextArgs;
    }

    /**
     * Resolve a tokenised expression
     * @param tokens A tokenised expression
     * @param typeHint A hint for default types when using non-strict mode
     * @returns The final resolved value
     */
    resolve(tokens: Array<any>, typeHint: string = "boolean"): any {
        // Handle groups first
        for (const token of tokens) {
            if (token.type == "group") {
                token["type"] = "value";
                token["value"] = this.resolve(token["value"]);
            }
        }

        // Then multiply and divide
        let i = 0;
        while (i < tokens.length) {
            const token = tokens[i];
            if (token.type == "operator") {
                if (token.value == "*") {
                    token["type"] = "value";
                    token["value"] = this.getStateValue(tokens[i - 1].value, typeHint) * this.getStateValue(tokens[i + 1].value, typeHint);
                    tokens.splice(i + 1, 1);
                    tokens.splice(i - 1, 1);
                    i -= 1;
                } else if (token.value == "/") {
                    token["type"] = "value";
                    token["value"] = this.getStateValue(tokens[i - 1].value, typeHint) / this.getStateValue(tokens[i + 1].value, typeHint);
                    tokens.splice(i + 1, 1);
                    tokens.splice(i - 1, 1);
                    i -= 1;
                }
            }
            i += 1;
        }

        // Then addition and subtraction
        i = 0;
        while (i < tokens.length) {
            const token = tokens[i];
            if (token.type == "operator") {
                if (token.value == "+") {
                    token["type"] = "value";
                    const lhs = tokens[i - 1].value;
                    const rhs = tokens[i + 1].value;
                    token["value"] = this.getStateValue(lhs, typeHint) + this.getStateValue(rhs, typeHint);
                    // if its a string then re-add the quotes
                    if (lhs.match(/^".*"$/) || rhs.match(/^".*"$/)) {
                        token["value"] = "\"" + token["value"] + "\"";
                    }
                    tokens.splice(i + 1, 1);
                    tokens.splice(i - 1, 1);
                    i -= 1;
                } else if (token.value == "-") {
                    token["type"] = "value";
                    token["value"] = this.getStateValue(tokens[i - 1].value, typeHint) - this.getStateValue(tokens[i + 1].value, typeHint);
                    tokens.splice(i + 1, 1);
                    tokens.splice(i - 1, 1);
                    i -= 1;
                }
            }
            i += 1;
        }

        return this.getStateValue(tokens[0].value);
    }

    /**
     * Check if a dialogue line contains meaninful information
     * @param line A line to check
     * @returns True if the line is valid
     */
    isValid(line: DialogueLine): boolean {
        if (line.type === TYPE_DIALOGUE && line.dialogue === "") return false;
        if (line.type === TYPE_MUTATION && line.mutation === null) return false
        if (line.type === TYPE_RESPONSE && line.responses.length === 0) return false;
        return true;
    }
}



class DialogueLine {
    type: string = TYPE_DIALOGUE;
    nextId: string;

    mutation: Mutation;

    character: string;
    dialogue: string;

    responses: Array<DialogueResponse>;

    constructor(data: LineData) {
        this.type = data.type;
        this.nextId = data.next_id;

        switch (this.type) {
            case TYPE_DIALOGUE:
                this.character = data.character;
                this.dialogue = data.text;
                break;

            case TYPE_MUTATION:
                this.mutation = data.mutation;
                break;
        }
    }
}


class DialogueResponse {
    prompt: string;
    nextId: string;

    constructor(data: LineData) {
        this.prompt = data.text;
        this.nextId = data.next_id;
    }
}


var dialogueManager = new DialogueManager();


if (typeof window !== "undefined") {
    window["DialogueManager"] = dialogueManager;
}

export default dialogueManager;
