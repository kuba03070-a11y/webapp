module.exports = (sequelize, DataTypes) => {
    const Channel = sequelize.define('Channel', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false
        },
        serverId: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        type: {
            type: DataTypes.ENUM('text', 'voice'),
            defaultValue: 'text'
        }
    });

    return Channel;
};
