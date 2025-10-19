// server.js - Complete Backend Server with WebSocket
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketIO = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// MongoDB Connection
mongoose.connect('mongodb://localhost:27017/lucky_fruit', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('✅ MongoDB Connected');
}).catch(err => {
    console.error('❌ MongoDB Connection Error:', err);
});

// User Schema
const userSchema = new mongoose.Schema({
    userId: { type: String, unique: true, required: true },
    name: { type: String, required: true },
    phone: String,
    balance: { type: Number, default: 2000 },
    todayWinnings: { type: Number, default: 0 },
    totalWinnings: { type: Number, default: 0 },
    totalBets: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Round Schema
const roundSchema = new mongoose.Schema({
    roundNumber: { type: Number, required: true },
    winningFruit: {
        id: String,
        emoji: String,
        name: String,
        multiplier: Number
    },
    totalBets: Number,
    totalWinners: Number,
    bets: [{
        userId: String,
        userName: String,
        fruitId: String,
        amount: Number,
        won: Boolean,
        winAmount: Number
    }],
    startTime: Date,
    endTime: Date,
    createdAt: { type: Date, default: Date.now }
});

const Round = mongoose.model('Round', roundSchema);

// Transaction Schema
const transactionSchema = new mongoose.Schema({
    userId: String,
    type: { type: String, enum: ['bet', 'win', 'deposit', 'withdrawal'] },
    amount: Number,
    roundNumber: Number,
    fruitId: String,
    description: String,
    createdAt: { type: Date, default: Date.now }
});

const Transaction = mongoose.model('Transaction', transactionSchema);

// Game State
let gameState = {
    currentRound: 1,
    timer: 45,
    isRunning: false,
    bettingEnabled: true,
    currentRoundBets: {},
    activeUsers: new Set()
};

// Fruits Configuration
const fruits = [
    { id: 'apple', emoji: '🍎', name: 'Apple', multiplier: 2 },
    { id: 'banana', emoji: '🍌', name: 'Banana', multiplier: 3 },
    { id: 'cherry', emoji: '🍒', name: 'Cherry', multiplier: 4 },
    { id: 'grape', emoji: '🍇', name: 'Grape', multiplier: 2.5 },
    { id: 'orange', emoji: '🍊', name: 'Orange', multiplier: 3 },
    { id: 'watermelon', emoji: '🍉', name: 'Melon', multiplier: 5 },
    { id: 'strawberry', emoji: '🍓', name: 'Berry', multiplier: 3.5 },
    { id: 'lemon', emoji: '🍋', name: 'Lemon', multiplier: 4.5 }
];

// API Routes

// User Registration/Login
app.post('/api/login', async (req, res) => {
    try {
        const { name, phone } = req.body;
        
        if (!name) {
            return res.status(400).json({ error: 'Name is required' });
        }

        const userId = 'USER' + Date.now().toString(36).toUpperCase();
        
        const user = new User({
            userId,
            name,
            phone,
            balance: 2000
        });

        await user.save();

        res.json({
            success: true,
            user: {
                userId: user.userId,
                name: user.name,
                phone: user.phone,
                balance: user.balance,
                todayWinnings: user.todayWinnings
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get User Data
app.get('/api/user/:userId', async (req, res) => {
    try {
        const user = await User.findOne({ userId: req.params.userId });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            success: true,
            user: {
                userId: user.userId,
                name: user.name,
                balance: user.balance,
                todayWinnings: user.todayWinnings,
                totalWinnings: user.totalWinnings
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Get All Active Users (Admin)
app.get('/api/admin/users', async (req, res) => {
    try {
        const users = await User.find().sort({ createdAt: -1 }).limit(100);
        res.json({ success: true, users });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Get Game State
app.get('/api/game/state', (req, res) => {
    res.json({
        success: true,
        gameState: {
            currentRound: gameState.currentRound,
            timer: gameState.timer,
            bettingEnabled: gameState.bettingEnabled,
            activeUsers: gameState.activeUsers.size
        }
    });
});

// Get Round History
app.get('/api/rounds/history', async (req, res) => {
    try {
        const rounds = await Round.find()
            .sort({ createdAt: -1 })
            .limit(20);
        
        res.json({ success: true, rounds });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Get User Transactions
app.get('/api/transactions/:userId', async (req, res) => {
    try {
        const transactions = await Transaction.find({ 
            userId: req.params.userId 
        })
        .sort({ createdAt: -1 })
        .limit(50);
        
        res.json({ success: true, transactions });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Admin: Start Round
app.post('/api/admin/start-round', (req, res) => {
    gameState.timer = 45;
    gameState.bettingEnabled = true;
    gameState.isRunning = true;
    gameState.currentRoundBets = {};
    
    io.emit('roundStarted', {
        roundNumber: gameState.currentRound,
        timer: gameState.timer
    });
    
    res.json({ success: true, message: 'Round started' });
});

// Admin: Stop Betting
app.post('/api/admin/stop-betting', (req, res) => {
    gameState.bettingEnabled = false;
    
    io.emit('bettingStopped');
    
    res.json({ success: true, message: 'Betting stopped' });
});

// Admin: Select Winner
app.post('/api/admin/select-winner', async (req, res) => {
    try {
        const { fruitId } = req.body;
        
        if (!fruitId) {
            return res.status(400).json({ error: 'Fruit ID required' });
        }

        const winningFruit = fruits.find(f => f.id === fruitId);
        
        if (!winningFruit) {
            return res.status(400).json({ error: 'Invalid fruit' });
        }

        // Process all bets
        const bets = gameState.currentRoundBets[fruitId] || [];
        let totalWinners = 0;
        let roundBets = [];

        for (const bet of bets) {
            const user = await User.findOne({ userId: bet.userId });
            
            if (user) {
                const winAmount = bet.amount * winningFruit.multiplier;
                user.balance += winAmount;
                user.todayWinnings += winAmount;
                user.totalWinnings += winAmount;
                await user.save();

                // Create transaction
                await Transaction.create({
                    userId: bet.userId,
                    type: 'win',
                    amount: winAmount,
                    roundNumber: gameState.currentRound,
                    fruitId: fruitId,
                    description: `Won ${winningFruit.name} - ${winningFruit.multiplier}x`
                });

                totalWinners++;
                
                roundBets.push({
                    userId: bet.userId,
                    userName: bet.userName,
                    fruitId: fruitId,
                    amount: bet.amount,
                    won: true,
                    winAmount: winAmount
                });
            }
        }

        // Save round to database
        await Round.create({
            roundNumber: gameState.currentRound,
            winningFruit,
            totalBets: Object.values(gameState.currentRoundBets).flat().length,
            totalWinners,
            bets: roundBets,
            endTime: new Date()
        });

        // Emit result to all clients
        io.emit('roundResult', {
            roundNumber: gameState.currentRound,
            winningFruit,
            totalWinners
        });

        // Start new round
        gameState.currentRound++;
        gameState.timer = 45;
        gameState.bettingEnabled = true;
        gameState.currentRoundBets = {};

        setTimeout(() => {
            io.emit('roundStarted', {
                roundNumber: gameState.currentRound,
                timer: gameState.timer
            });
        }, 5000);

        res.json({ 
            success: true, 
            message: 'Winner selected',
            winningFruit,
            totalWinners
        });

    } catch (error) {
        console.error('Error selecting winner:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// WebSocket Connection Handling
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    gameState.activeUsers.add(socket.id);
    
    // Send current game state
    socket.emit('gameState', {
        currentRound: gameState.currentRound,
        timer: gameState.timer,
        bettingEnabled: gameState.bettingEnabled,
        activeUsers: gameState.activeUsers.size
    });

    // Handle bet placement
    socket.on('placeBet', async (data) => {
        try {
            const { userId, userName, fruitId, amount } = data;
            
            if (!gameState.bettingEnabled) {
                socket.emit('betError', { message: 'Betting is closed' });
                return;
            }

            const user = await User.findOne({ userId });
            
            if (!user) {
                socket.emit('betError', { message: 'User not found' });
                return;
            }

            if (user.balance < amount) {
                socket.emit('betError', { message: 'Insufficient balance' });
                return;
            }

            // Deduct balance
            user.balance -= amount;
            user.totalBets += amount;
            await user.save();

            // Add to current round bets
            if (!gameState.currentRoundBets[fruitId]) {
                gameState.currentRoundBets[fruitId] = [];
            }

            gameState.currentRoundBets[fruitId].push({
                userId,
                userName,
                amount,
                socketId: socket.id
            });

            // Create transaction
            await Transaction.create({
                userId,
                type: 'bet',
                amount: -amount,
                roundNumber: gameState.currentRound,
                fruitId,
                description: `Bet on ${fruits.find(f => f.id === fruitId)?.name}`
            });

            socket.emit('betPlaced', {
                success: true,
                newBalance: user.balance,
                fruitId,
                amount
            });

            // Broadcast to admin
            io.emit('newBet', {
                userId,
                userName,
                fruitId,
                amount,
                roundNumber: gameState.currentRound
            });

        } catch (error) {
            console.error('Bet error:', error);
            socket.emit('betError', { message: 'Server error' });
        }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        gameState.activeUsers.delete(socket.id);
    });
});

// Timer Loop
setInterval(() => {
    if (gameState.isRunning && gameState.timer > 0) {
        gameState.timer--;
        
        io.emit('timerUpdate', { timer: gameState.timer });
        
        if (gameState.timer === 10) {
            gameState.bettingEnabled = false;
            io.emit('bettingStopped');
        }
    }
}, 1000);

// Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🎮 Game: http://localhost:${PORT}`);
    console.log(`👨‍💼 Admin: http://localhost:${PORT}?admin=true&key=lucky2025`);
});
