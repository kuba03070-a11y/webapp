module.exports = (sequelize, DataTypes) => {
    const Server = sequelize.define('Server', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false
        },
        ownerId: {
            type: DataTypes.INTEGER,
            allowNull: false
        }
    });

    return Server;
};
