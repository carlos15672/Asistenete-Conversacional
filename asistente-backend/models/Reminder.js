const { DataTypes } = require('sequelize');
const sequelize = require('./database');

const Reminder = sequelize.define('Reminder', {
  title: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  time: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  isCritical: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  isCompleted: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
});

module.exports = Reminder;
