# Backup and recovery status

Automated database backup, retention, and restore procedures have not been implemented. Before live use, schedule encrypted `mysqldump` backups to storage separate from the database host, restrict access to backup files, define retention with the business owner, and rehearse a restore into an isolated database. Record restore time and confirm transaction counts and key balances after recovery. This document is a status note, not proof of a tested recovery process.
