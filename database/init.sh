#!/bin/bash
# Script d'initialisation de la base Immo Sniper
# Usage : ./database/init.sh

set -e

echo "🗄️  Initialisation de la base Immo Sniper..."

# Variables (à adapter selon ton environnement)
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-immo_db}"
DB_USER="${DB_USER:-immo_user}"
DB_PASSWORD="${DB_PASSWORD:-immo_secret}"

export PGPASSWORD="$DB_PASSWORD"

# 1. Créer la base si elle n'existe pas
echo "📦 Vérification de la base $DB_NAME..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1 || \
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c "CREATE DATABASE $DB_NAME;"

# 2. Activer PostGIS
echo "🌍 Activation de PostGIS..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS postgis;"

# 3. Exécuter le schéma
echo "📋 Création des tables..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$(dirname "$0")/schema.sql"

# 4. Insérer les règles PLU par défaut
echo "🏗️  Insertion des règles PLU..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" <<EOF
INSERT INTO plu_rules (zone_code, zone_type, constructibilite, conseil_investissement) VALUES
  ('UA', 'urbaine', 'Zone très dense, extensions limitées', 'Forte demande locative, idéal locatif meublé'),
  ('UB', 'urbaine', 'Extensions possibles sous conditions de COS', 'Bon potentiel d extension, idéal familles'),
  ('UC', 'urbaine', 'Immeubles collectifs autorisés', 'Potentiel de division en plusieurs lots'),
  ('UD', 'urbaine', 'Zone pavillonnaire', 'Calme, bon pour location longue durée'),
  ('1AU', 'à urbaniser', 'Constructible si raccordement aux réseaux', 'Fort potentiel de valorisation à moyen terme'),
  ('2AU', 'à urbaniser', 'Non constructible à court terme', 'Spéculation long terme uniquement'),
  ('A', 'agricole', 'Non constructible sauf dérogation', 'À éviter sauf projet agricole'),
  ('N', 'naturelle', 'Non constructible', 'À éviter')
ON CONFLICT (zone_code) DO UPDATE SET 
  constructibilite = EXCLUDED.constructibilite,
  conseil_investissement = EXCLUDED.conseil_investissement;
EOF

echo "✅ Base initialisée avec succès !"
echo ""
echo "📊 Tables créées :"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "\dt"