import { io } from 'socket.io-client';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { createSpinner } from 'nanospinner';
import { readFileSync } from 'fs';
import readline from 'readline';

const config = JSON.parse(readFileSync('./config.json'));

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));


const STATES = {
    START: 0,
    LOBBY: 1,
    INGAME: 2
}

const COLORS = {
    r: 'Red',
    g: 'Green',
    b: 'Blue',
    y: 'Yellow',
    l: 'Purple',
    t: 'Turquoise',
}

const CHALK_MAPPING = {
    'r': chalk.red,
    'g': chalk.green,
    'b': chalk.blue,
    'y': chalk.yellow,
    'l': chalk.magenta,
    't': chalk.cyan,
}

const TYPES = {
    p2: '+2',
    s: 'Reverse',
    o: 'Skip',
    cycle: 'Cycle',
    rand: 'Random',
    wish: 'Wish',
    p4wish: '+4 Wish',
}

const socket = io(config.onu_url);
socket.asyncEmit = (event, data) => {
    return new Promise((resolve, reject) => {
        socket.emit(event, (res) => {
            if (res.error) {
                reject(res.error);
            } else {
                resolve(res);
            }
        });
    });
}

var game = {
    lobbycode: 'default',
    username: 'default',
    cards: [],
    topcard: null,
    players: [],
    drawamount: 0,
    state: STATES.START,
    admin: false,
}

console.log("Welcome to " + chalk.yellow.bold("Onu!"));

function waitForState(state) {
    return new Promise(resolve => {
        const interval = setInterval(() => {
            if (game.state === state) {
                clearInterval(interval);
                resolve();
            }
        }, 100);
    });
}

function sortCards(cards) {
    const rCards = cards.filter(card => card.color === 'r').sort((a, b) => a.type.charCodeAt(0) - b.type.charCodeAt(0));
    const gCards = cards.filter(card => card.color === 'g').sort((a, b) => a.type.charCodeAt(0) - b.type.charCodeAt(0));
    const tCards = cards.filter(card => card.color === 't').sort((a, b) => a.type.charCodeAt(0) - b.type.charCodeAt(0));
    const bCards = cards.filter(card => card.color === 'b').sort((a, b) => a.type.charCodeAt(0) - b.type.charCodeAt(0));
    const lCards = cards.filter(card => card.color === 'l').sort((a, b) => a.type.charCodeAt(0) - b.type.charCodeAt(0));
    const yCards = cards.filter(card => card.color === 'y').sort((a, b) => a.type.charCodeAt(0) - b.type.charCodeAt(0));
    const etcCards = cards.filter(card => card.color === '').sort((a, b) => a.type.charCodeAt(0) - b.type.charCodeAt(0));

    return rCards.concat(gCards).concat(tCards).concat(bCards).concat(lCards).concat(yCards).concat(etcCards);
}

function prettyPrintCard(card) {
    const text = `${card.color in COLORS ? COLORS[card.color] : card.color} ${card.type in TYPES ? TYPES[card.type] : card.type}`.trim();
    return { ...card, text: card.color in CHALK_MAPPING ? CHALK_MAPPING[card.color](text) : text };
}

function printDeck() {
    console.log(chalk.bold("Top Card: ") + prettyPrintCard(game.topcard).text);

    console.log(chalk.bold("Deck:"));
    sortCards(game.cards).forEach(card => console.log(`\t${prettyPrintCard(card).text}`));
}

async function getUsername() {
    var username;
    while (!username) {
        const { name } = await inquirer.prompt([
            {
                type: "input",
                name: "name",
                message: "What is your name?"
            }
        ]);
        username = name;
    }
    return username;
}

async function getLobbycode() {
    var lobbycode;
    while (!lobbycode) {
        const { code } = await inquirer.prompt([
            {
                type: "input",
                name: "code",
                message: "What lobby do you want to join?"
            }
        ]);
        lobbycode = code;
    }
    return lobbycode;
}

game.username = await getUsername();
game.lobbycode = await getLobbycode();

socket.emit('joinLobby', game.lobbycode, game.username, (err) => {
    const spinner = createSpinner('Joining lobby...').start();
    if (err) {
        spinner.error({ text: `There was an error joining the lobby: ${err}` });
        process.exit(1);
    }
    game.state = STATES.LOBBY;
    spinner.success({ text: `Joined lobby ${game.lobbycode}! Invite friends using this link: https://onu.lebogo.tk/#${game.lobbycode}` });
});

socket.on('playerJoin', (player) => {
    console.log(chalk.green(`${player.username} has joined the lobby!`));
    game.players.push(player);
    game.players = [...new Set(game.players)];
})

socket.on('openLobby', (lobby) => {
    game.players = lobby.players;
    game.me = lobby.me;
})

socket.on('playerLeave', (player) => {
    console.log(chalk.red(`${player.username} has left the lobby!`));
    game.players = game.players.filter(p => p.username !== player.username);
})

socket.on('gameEnded', () => {
    game.state = STATES.LOBBY;
})

socket.on('admin', async () => {
    game.admin = true;

    await waitForState(STATES.LOBBY);

    await inquirer.prompt([
        {
            type: "confirm",
            name: "startGame",
            message: "Press enter to start the game!\n\n",
            default: "Y",
            suffix: "",
        }
    ]);
    socket.emit('startGame');

})

socket.on('starting', async () => {
    game.state = STATES.INGAME;
    game.cards = await socket.asyncEmit('requestInitialCards');
    game.topcard = await socket.asyncEmit('requestInitialStack');

    if (game.players[0].username != game.username) printDeck();

})

socket.on('addStackCard', (card) => {
    game.topcard = card;
    card = prettyPrintCard(card);
    chalk.green(`Top Card: ${card.text}`);
})

socket.on('addDeckCard', (received) => {
    if ((received).length) game.cards = [...game.cards, ...received];
    if (!(received).length) game.cards.push(received);
    printDeck();
})

socket.on('clearCards', (cb) => {
    console.log("Clearing cards...")
    game.cards = [];
    cb();
})

socket.on('wishColor', async () => {
    const { color } = await inquirer.prompt([
        {
            type: "list",
            name: "color",
            message: "What color do you want?",
            choices: [
                { name: chalk.red.bold("Red"), value: "r" },
                { name: chalk.green.bold("Green"), value: "g" },
                { name: chalk.blue.bold("Blue"), value: "b" },
                { name: chalk.yellow.bold("Yellow"), value: "y" },
            ]
        }
    ]);
    socket.emit('wishColor', color)
})

async function makeTurn() {
    for (let i = 0; i < 100; i++) console.log("\n");
    var cards = sortCards(game.cards).map(card => {
        card = prettyPrintCard(card);
        return {
            name: card.text,
            value: card.key,
        }
    });

    cards = [{ name: `Draw Card/s (Draw Amount: ${Math.max(game.drawamount, 0)})`, value: 'draw' }, ...cards];

    const { playedCard } = await inquirer.prompt([
        {
            type: "list",
            name: "playedCard",
            message: `What card do you want to play? (Top Card: ${chalk.bold(prettyPrintCard(game.topcard).text)}) `,
            choices: cards
        }
    ]);

    if (playedCard.startsWith("draw")) {
        return socket.emit('cardRequest');
    }

    socket.emit('playCard', playedCard, (done) => {
        if (!done) return makeTurn();
        game.cards = game.cards.filter(c => c.key !== playedCard);
        printDeck();
    });
}

socket.on('yourTurn', async (drawamount) => {
    await sleep(100);
    console.log(drawamount);
    game.drawamount = drawamount;
    makeTurn();
})