// server-pg.js - API with PostgreSQL
const express = require('express');
const cors = require('cors');
const { Client } = require('pg');
require('dotenv').config();

const app = express();
const PORT = 3000;

// Database connection
const client = new Client({
    user: 'postgres',
    host: 'localhost',
    database: 'bali_arcade',
    password: 'admin123', // CHANGE THIS!
    port: 5432,
});

// Connect to database
client.connect()
    .then(() => console.log('✅ Connected to PostgreSQL'))
    .catch(err => console.error('❌ Database connection error:', err));

app.use(cors());
app.use(express.json());

// ============ API ENDPOINTS ============

// 1. Health Check
app.get('/api/health', async (req, res) => {
    try {
        const result = await client.query('SELECT NOW()');
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            database: 'connected',
            time: result.rows[0].now
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// 2. Get all floors
app.get('/api/floors', async (req, res) => {
    try {
        const result = await client.query(`
            SELECT * FROM mall.floors ORDER BY floor_number
        `);
        res.json({
            floors: result.rows.map(f => f.floor_number),
            current: 'ground',
            count: result.rows.length
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 3. Get specific floor data (GeoJSON for map)
app.get('/api/map/:floor', async (req, res) => {
    try {
        const floorNumber = parseInt(req.params.floor);
        
        const result = await client.query(`
            SELECT 
                s.*,
                f.floor_name
            FROM mall.stores s
            JOIN mall.floors f ON s.floor_id = f.id
            WHERE f.floor_number = $1
        `, [floorNumber]);
        
        // Convert to GeoJSON format
        const geojson = {
            type: "FeatureCollection",
            features: result.rows.map(store => ({
                type: "Feature",
                properties: {
                    id: store.store_id,
                    name: store.name,
                    type: store.type,
                    category: store.category,
                    status: store.status,
                    floor: store.floor_name
                },
                geometry: store.coordinates
            }))
        };
        
        res.json(geojson);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 4. Get all stores with filters
app.get('/api/stores', async (req, res) => {
    try {
        const { floor, type, category, status } = req.query;
        
        let sql = `
            SELECT 
                s.*,
                f.floor_name,
                sd.products,
                sd.brands,
                sd.hours,
                sd.rating,
                sd.reviews
            FROM mall.stores s
            JOIN mall.floors f ON s.floor_id = f.id
            LEFT JOIN mall.store_details sd ON s.id = sd.store_id
            WHERE 1=1
        `;
        const params = [];
        let paramCount = 1;
        
        if (floor) {
            sql += ` AND f.floor_number = $${paramCount}`;
            params.push(parseInt(floor));
            paramCount++;
        }
        if (type) {
            sql += ` AND s.type = $${paramCount}`;
            params.push(type);
            paramCount++;
        }
        if (category) {
            sql += ` AND s.category = $${paramCount}`;
            params.push(category);
            paramCount++;
        }
        if (status) {
            sql += ` AND s.status = $${paramCount}`;
            params.push(status);
            paramCount++;
        }
        
        sql += ' ORDER BY s.name';
        
        const result = await client.query(sql, params);
        res.json({
            total: result.rows.length,
            stores: result.rows
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 5. Get specific store by ID
app.get('/api/stores/:id', async (req, res) => {
    try {
        const result = await client.query(`
            SELECT 
                s.*,
                f.floor_name,
                sd.products,
                sd.brands,
                sd.hours,
                sd.contact_phone,
                sd.contact_email,
                sd.website,
                sd.rating,
                sd.reviews,
                sd.description
            FROM mall.stores s
            JOIN mall.floors f ON s.floor_id = f.id
            LEFT JOIN mall.store_details sd ON s.id = sd.store_id
            WHERE s.store_id = $1
        `, [req.params.id]);
        
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.status(404).json({ error: `Store '${req.params.id}' not found` });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 6. Search stores
app.get('/api/search', async (req, res) => {
    try {
        const { q, floor } = req.query;
        
        if (!q || q.length < 2) {
            return res.status(400).json({ 
                error: 'Search query must be at least 2 characters' 
            });
        }
        
        let sql = `
            SELECT 
                s.*,
                f.floor_name,
                sd.rating,
                sd.reviews
            FROM mall.stores s
            JOIN mall.floors f ON s.floor_id = f.id
            LEFT JOIN mall.store_details sd ON s.id = sd.store_id
            WHERE 
                s.name ILIKE $1 OR 
                s.store_id ILIKE $1 OR
                s.category ILIKE $1 OR
                s.type ILIKE $1
        `;
        const params = [`%${q}%`];
        
        if (floor) {
            sql += ` AND f.floor_number = $2`;
            params.push(parseInt(floor));
        }
        
        sql += ' ORDER BY s.name';
        
        const result = await client.query(sql, params);
        res.json({
            query: q,
            total: result.rows.length,
            results: result.rows
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 7. Get categories
app.get('/api/categories', async (req, res) => {
    try {
        const result = await client.query(`
            SELECT * FROM mall.categories ORDER BY name
        `);
        res.json({
            categories: result.rows,
            total: result.rows.length
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 8. Get statistics
app.get('/api/stats', async (req, res) => {
    try {
        const result = await client.query(`
            SELECT 
                (SELECT COUNT(*) FROM mall.floors) as total_floors,
                (SELECT COUNT(*) FROM mall.stores) as total_stores,
                (SELECT COUNT(*) FROM mall.stores WHERE status = 'active') as active_stores,
                (SELECT COUNT(*) FROM mall.stores WHERE status = 'vacant') as vacant_stores,
                (SELECT COUNT(*) FROM mall.stores WHERE status = 'under-renovation') as renovation_stores
        `);
        
        // Get stores by type
        const byType = await client.query(`
            SELECT type, COUNT(*) FROM mall.stores GROUP BY type
        `);
        
        // Get stores by floor
        const byFloor = await client.query(`
            SELECT f.floor_name, COUNT(s.id) 
            FROM mall.floors f
            LEFT JOIN mall.stores s ON f.id = s.floor_id
            GROUP BY f.id, f.floor_name
            ORDER BY f.floor_number
        `);
        
        res.json({
            ...result.rows[0],
            by_type: byType.rows,
            by_floor: byFloor.rows
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`\n🚀 Bali Arcade API Server (PostgreSQL)`);
    console.log(`📡 URL: http://localhost:${PORT}`);
    console.log(`\n📋 Available Endpoints:`);
    console.log(`   GET  /api/health`);
    console.log(`   GET  /api/floors`);
    console.log(`   GET  /api/map/:floor       (GeoJSON)`);
    console.log(`   GET  /api/stores`);
    console.log(`   GET  /api/stores/:id`);
    console.log(`   GET  /api/search?q=keyword`);
    console.log(`   GET  /api/categories`);
    console.log(`   GET  /api/stats\n`);
});